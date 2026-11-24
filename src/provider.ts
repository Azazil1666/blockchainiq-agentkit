import "reflect-metadata";
import { ActionProvider, CreateAction } from "@coinbase/agentkit";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import {
  BRIEF_PATH,
  BRIEF_PRICE_USD,
  CATALOG_PATH,
  DEFAULT_BASE_URL,
  DEFAULT_MAX_USD_PER_CALL,
  EVENT_RISK_PATH,
  EVENT_RISK_PRICE_USD,
  PRIVATE_KEY_ENV_VAR,
} from "./constants.js";
import {
  GetCatalogSchema,
  GetEventRiskSchema,
  GetMarketBriefSchema,
  type GetEventRiskArgs,
} from "./schemas.js";
import type {
  BlockchainIqProviderOptions,
  BriefData,
  CatalogResource,
  EventRiskData,
  PaidCallResult,
} from "./types.js";
import {
  buildPaidFetch,
  parseSettlementProof,
  priceUsdFromPaymentRequired,
} from "./x402Client.js";

/**
 * Coinbase AgentKit action provider for the Blockchain IQ pay-per-call
 * crypto data API.
 *
 * The API sells market data one request at a time over the open x402
 * standard: no account, no API key — a wallet holding a little USDC on Base
 * is the only credential. An unpaid request returns HTTP 402 with the price;
 * the x402 client signs a USDC payment and retries; the settled response
 * carries a PAYMENT-RESPONSE header with the transaction hash.
 *
 * Two resources qualify for the Blockchain IQ bounty (one working paid call
 * to either is enough):
 * - `get_market_brief` — GET /api/x402/v1/brief, $0.01, parameter-free
 * - `get_event_risk`  — GET /api/x402/v1/event-risk, $0.05, days 1-90
 *
 * `get_catalog` is free and needs no wallet.
 *
 * The paying wallet comes from the AGENT_PRIVATE_KEY env var (or the
 * `privateKey` option): a dedicated throwaway wallet with a small USDC
 * balance on Base. The key is never logged. Paid actions refuse clearly
 * when no key is configured, and the per-payment cap (default $2.00)
 * is enforced twice — once by a pre-flight read of the real 402 price,
 * once by the x402 client's own spend controls.
 */
export class BlockchainIqActionProvider extends ActionProvider {
  private readonly privateKey: string | undefined;
  private readonly maxUsdPerCall: number;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private paidFetch: typeof fetch | undefined;

  constructor(options: BlockchainIqProviderOptions = {}) {
    super("blockchain-iq", []);
    const key = options.privateKey ?? process.env[PRIVATE_KEY_ENV_VAR];
    if (key !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(key)) {
      throw new Error(
        `${PRIVATE_KEY_ENV_VAR} must be a 0x-prefixed 64-hex-character private key`,
      );
    }
    this.privateKey = key;
    this.maxUsdPerCall = options.maxUsdPerCall ?? DEFAULT_MAX_USD_PER_CALL;
    this.baseUrl =
      options.baseUrl ?? process.env.BLOCKCHAIN_IQ_BASE_URL ?? DEFAULT_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * Address of the configured paying wallet, or null when no key is set.
   * This is the payout address for the bounty claim (Jeremy Green pays the
   * claim to the address in the claim email — use this one).
   */
  public getPayerAddress(): string | null {
    if (!this.privateKey) {
      return null;
    }
    return privateKeyToAccount(this.privateKey as `0x${string}`).address;
  }

  /** Whether a paying wallet is configured. */
  public hasWallet(): boolean {
    return this.privateKey !== undefined;
  }

  /**
   * The provider is network-agnostic (like DefiLlama's): the data is the
   * same on any network, and payment always settles in USDC on Base.
   */
  supportsNetwork(): boolean {
    return true;
  }

  @CreateAction({
    name: "get_catalog",
    description:
      "List every Blockchain IQ x402 resource with its path and price per call. Free — no wallet, no payment. Use it to discover resources and confirm prices before buying.",
    schema: GetCatalogSchema,
  })
  public async getCatalog(_args: z.infer<typeof GetCatalogSchema>): Promise<string> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${CATALOG_PATH}`);
      if (!res.ok) {
        return `Error fetching the Blockchain IQ catalog: HTTP ${res.status}`;
      }
      const body = (await res.json()) as { data?: unknown[] };
      const resources: CatalogResource[] = [];
      for (const r of Array.isArray(body.data) ? body.data : []) {
        const item = r as Record<string, unknown>;
        if (
          typeof item.id === "string" &&
          typeof item.method === "string" &&
          typeof item.path === "string" &&
          typeof item.price === "string" &&
          typeof item.title === "string" &&
          typeof item.description === "string"
        ) {
          resources.push({
            id: item.id,
            method: item.method,
            path: item.path,
            price: item.price,
            title: item.title,
            description: item.description,
          });
        }
      }
      return JSON.stringify({ count: resources.length, resources }, null, 2);
    } catch (error) {
      return `Error fetching the Blockchain IQ catalog: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  @CreateAction({
    name: "get_market_brief",
    description:
      "Buy the Blockchain IQ market brief for $0.01 (x402, USDC on Base): BTC, ETH, SOL and XRP prices with 24h/7d/30d moves and rank, scheduled macro and crypto events in the next 48 hours, and short risk flags. Parameter-free. Returns the brief plus the settlement proof (transaction hash).",
    schema: GetMarketBriefSchema,
  })
  public async getMarketBrief(
    args: z.infer<typeof GetMarketBriefSchema>,
  ): Promise<string> {
    GetMarketBriefSchema.parse(args);
    const result = await this.callPaid<BriefData>(BRIEF_PATH, BRIEF_PRICE_USD);
    return typeof result === "string" ? result : JSON.stringify(result, null, 2);
  }

  @CreateAction({
    name: "get_event_risk",
    description:
      "Buy Blockchain IQ event risk for $0.05 (x402, USDC on Base): scheduled market-moving events for the next N days (default 7, up to 90) — US data releases, FOMC/ECB/BoJ decisions, Treasury auctions and crypto milestones, each with importance 1-3 and source. Returns the events plus the settlement proof (transaction hash).",
    schema: GetEventRiskSchema,
  })
  public async getEventRisk(args: GetEventRiskArgs): Promise<string> {
    const parsed = GetEventRiskSchema.parse(args);
    const params = new URLSearchParams({
      days: String(parsed.days),
      minImportance: String(parsed.minImportance),
    });
    const result = await this.callPaid<EventRiskData>(
      `${EVENT_RISK_PATH}?${params.toString()}`,
      EVENT_RISK_PRICE_USD,
    );
    return typeof result === "string" ? result : JSON.stringify(result, null, 2);
  }

  /**
   * One paid call: pre-flight the real 402 price against the cap, then pay
   * through x402 and return the data with its settlement proof.
   * Returns an error string (never throws) when anything refuses or fails —
   * a 404 or any error response is never charged.
   */
  private async callPaid<TData>(
    path: string,
    knownPriceUsd: number,
  ): Promise<PaidCallResult<TData> | string> {
    if (!this.privateKey) {
      return (
        "Error: no paying wallet configured. Set AGENT_PRIVATE_KEY to the " +
        "0x-prefixed private key of a dedicated wallet holding a little USDC " +
        "on Base, then retry. Nothing was called and nothing was charged."
      );
    }
    if (knownPriceUsd > this.maxUsdPerCall) {
      return (
        `Error: this call costs $${knownPriceUsd.toFixed(2)}, above the ` +
        `per-payment cap of $${this.maxUsdPerCall.toFixed(2)}. Raise ` +
        `MAX_USD_PER_CALL to allow it. Nothing was called and nothing was charged.`
      );
    }

    const url = `${this.baseUrl}${path}`;
    try {
      // Pre-flight: a plain GET is free to read — a 402 is never charged.
      // It tells us the real price (the catalogue is the source of truth,
      // and prices have changed before) so we can refuse before paying.
      const probe = await this.fetchImpl(url);
      if (probe.status === 402) {
        const livePrice = priceUsdFromPaymentRequired(
          probe.headers.get("payment-required"),
        );
        if (livePrice !== null && livePrice > this.maxUsdPerCall) {
          return (
            `Error: the server asks $${livePrice.toFixed(2)} for this call, ` +
            `above the per-payment cap of $${this.maxUsdPerCall.toFixed(2)}. ` +
            `Raise MAX_USD_PER_CALL to allow it. Nothing was paid.`
          );
        }
      } else if (probe.ok) {
        // Currently free (e.g. a free-until promo): no payment needed.
        const data = (await probe.json()) as { data: TData };
        return {
          resource: path,
          priceUsd: 0,
          data: data.data,
          settlement: null,
        };
      }
      // Any other probe status: fall through to the paid fetch, which will
      // surface the real error. (A failed probe alone never pays.)
    } catch (error) {
      return `Error reaching Blockchain IQ (${url}): ${error instanceof Error ? error.message : String(error)}`;
    }

    try {
      const payFetch = this.getPaidFetch();
      const res = await payFetch(url);
      if (!res.ok) {
        const snippet = await safeBodySnippet(res);
        return (
          `Error: Blockchain IQ returned HTTP ${res.status} for ${path}` +
          (snippet ? `: ${snippet}` : "") +
          ". Errors are never charged."
        );
      }
      const body = (await res.json()) as { data: TData };
      return {
        resource: path,
        priceUsd: knownPriceUsd,
        data: body.data,
        settlement: parseSettlementProof(res.headers.get("payment-response")),
      };
    } catch (error) {
      return `Error during the paid call to ${path}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private getPaidFetch(): typeof fetch {
    if (!this.paidFetch) {
      // Private key is checked in callPaid before this is ever reached.
      this.paidFetch = buildPaidFetch(this.privateKey!, this.maxUsdPerCall, this.fetchImpl);
    }
    return this.paidFetch;
  }
}

/** Factory matching the built-in providers' naming (`defillamaActionProvider`). */
export const blockchainIqActionProvider: (
  options?: BlockchainIqProviderOptions,
) => BlockchainIqActionProvider = (options = {}) =>
  new BlockchainIqActionProvider(options);

async function safeBodySnippet(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 200);
  } catch {
    return "";
  }
}
