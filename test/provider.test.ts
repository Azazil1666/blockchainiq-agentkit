import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BlockchainIqActionProvider,
  blockchainIqActionProvider,
} from "../dist/provider.js";
import {
  parseSettlementProof,
  priceUsdFromPaymentRequired,
} from "../dist/x402Client.js";
import { BRIEF_PATH, CATALOG_PATH } from "../dist/constants.js";

/**
 * Tests for the Blockchain IQ AgentKit provider.
 *
 * NO paid call happens here and NO funded wallet is needed:
 * - paid flows run against a recording stub fetch that replays a REAL
 *   HTTP 402 header captured from the live API (test/fixtures-402-header.txt)
 *   and a fabricated 200 + PAYMENT-RESPONSE settlement header;
 * - the signing key is Hardhat account #0, a publicly known test key that
 *   holds nothing on mainnet;
 * - the two live tests run only with BIQ_LIVE_TESTS=1 and only hit FREE
 *   endpoints (catalogue, sample).
 */

// Hardhat account #0 — publicly known test key, empty on mainnet. Safe to
// commit: it is the standard throwaway key from the Hardhat docs.
const TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const FIXTURE_402 = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures-402-header.txt"),
  "utf8",
).trim();

const SETTLEMENT_TX = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

function b64(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64");
}

const SETTLEMENT_HEADER = b64({
  success: true,
  transaction: SETTLEMENT_TX,
  network: "eip155:8453",
  amount: "10000",
  payer: TEST_ADDRESS,
});

const BRIEF_BODY = {
  source: "Blockchain IQ",
  data: {
    asOf: "2026-11-24T00:00:00.000Z",
    coins: [
      {
        coinId: "bitcoin",
        symbol: "btc",
        price: 90000,
        change24h: 1.2,
        change7d: -2.3,
        change30d: 5.6,
        marketCapRank: 1,
        priceSource: "coingecko",
      },
    ],
    events: [],
    flags: [],
  },
};

const CATALOG_FIXTURE = {
  source: "Blockchain IQ",
  data: [
    {
      id: "catalog",
      method: "GET",
      path: "/api/x402/v1",
      price: "free",
      title: "Catalog",
      description: "This resource list, prices, and price classes.",
    },
    {
      id: "brief",
      method: "GET",
      path: "/api/x402/v1/brief",
      price: "$0.01",
      title: "Crypto Market Brief for Agents",
      description: "The opening call of a trading-agent loop, parameter-free.",
    },
    {
      id: "event-risk",
      method: "GET",
      path: "/api/x402/v1/event-risk",
      price: "$0.05",
      title: "Event Risk - Next 7 Days",
      description: "Scheduled market-moving events for the next N days.",
    },
  ],
};

interface RecordedRequest {
  url: string;
  headers: Record<string, string>;
}

function makeStubFetch(
  handler: (req: RecordedRequest) => Response,
): { fetch: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const stub = (async (input: unknown, init?: RequestInit) => {
    // The x402 client passes a Request object, not a plain URL string.
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const headers: Record<string, string> = {};
    const raw = (init?.headers ?? {}) as Record<string, string>;
    for (const [k, v] of Object.entries(raw)) {
      headers[k.toLowerCase()] = String(v);
    }
    // A Request object passed as input carries its own headers.
    if (typeof input === "object" && input !== null && "headers" in input) {
      for (const [k, v] of (input as Request).headers.entries()) {
        headers[k.toLowerCase()] = v;
      }
    }
    requests.push({ url, headers });
    return handler({ url, headers });
  }) as unknown as typeof fetch;
  return { fetch: stub, requests };
}

function header402(amountAtomic: string): string {
  const decoded = JSON.parse(
    Buffer.from(FIXTURE_402, "base64").toString("utf8"),
  ) as { accepts: Array<Record<string, unknown>> };
  decoded.accepts[0].amount = amountAtomic;
  return b64(decoded);
}

describe("provider construction", () => {
  test("name is blockchain-iq, network-agnostic, no wallet by default", () => {
    const provider = blockchainIqActionProvider();
    assert.equal(provider.name, "blockchain-iq");
    assert.equal(provider.hasWallet(), false);
    assert.equal(provider.getPayerAddress(), null);
    assert.equal(
      provider.supportsNetwork({ protocolFamily: "evm", networkId: "base", chainId: "8453" }),
      true,
    );
    assert.equal(
      provider.supportsNetwork({ protocolFamily: "svm", networkId: "solana" }),
      true,
    );
  });

  test("malformed private key throws at construction", () => {
    assert.throws(
      () => blockchainIqActionProvider({ privateKey: "not-a-key" }),
      /0x-prefixed 64-hex/,
    );
    assert.throws(
      () => blockchainIqActionProvider({ privateKey: "0x1234" }),
      /0x-prefixed 64-hex/,
    );
  });

  test("configured key exposes the payer address, never the key", () => {
    const provider = blockchainIqActionProvider({ privateKey: TEST_PRIVATE_KEY });
    assert.equal(provider.hasWallet(), true);
    assert.equal(provider.getPayerAddress(), TEST_ADDRESS);
  });

  test("getActions exposes the three actions with zod schemas", () => {
    const provider = blockchainIqActionProvider();
    const actions = provider.getActions({} as never);
    // AgentKit prefixes every action name with the provider class name.
    assert.deepEqual(
      actions.map((a) => a.name).sort(),
      [
        "BlockchainIqActionProvider_get_catalog",
        "BlockchainIqActionProvider_get_event_risk",
        "BlockchainIqActionProvider_get_market_brief",
      ],
    );
    for (const action of actions) {
      assert.equal(typeof action.description, "string");
      assert.ok(action.description.length > 20);
      assert.equal(typeof action.schema.parse, "function");
      assert.equal(typeof action.invoke, "function");
    }
  });
});

describe("free catalogue", () => {
  test("get_catalog parses the catalogue and needs no wallet", async () => {
    const { fetch, requests } = makeStubFetch(
      () =>
        new Response(JSON.stringify(CATALOG_FIXTURE), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const provider = blockchainIqActionProvider({ fetchImpl: fetch });
    const out = JSON.parse(await provider.getCatalog({}));
    assert.equal(out.count, 3);
    const brief = out.resources.find((r: { id: string }) => r.id === "brief");
    assert.equal(brief.path, "/api/x402/v1/brief");
    assert.equal(brief.price, "$0.01");
    const risk = out.resources.find((r: { id: string }) => r.id === "event-risk");
    assert.equal(risk.price, "$0.05");
    assert.equal(requests.length, 1);
    assert.ok(requests[0].url.endsWith(CATALOG_PATH));
  });
});

describe("paid actions without a wallet", () => {
  test("get_market_brief refuses and makes zero requests", async () => {
    const { fetch, requests } = makeStubFetch(
      () => new Response("{}", { status: 200 }),
    );
    const provider = blockchainIqActionProvider({ fetchImpl: fetch });
    const out = await provider.getMarketBrief({});
    assert.match(out, /no paying wallet configured/i);
    assert.match(out, /AGENT_PRIVATE_KEY/);
    assert.equal(requests.length, 0);
  });

  test("get_event_risk refuses without a wallet too", async () => {
    const { fetch, requests } = makeStubFetch(
      () => new Response("{}", { status: 200 }),
    );
    const provider = blockchainIqActionProvider({ fetchImpl: fetch });
    const out = await provider.getEventRisk({ days: 7, minImportance: 1 });
    assert.match(out, /no paying wallet configured/i);
    assert.equal(requests.length, 0);
  });
});

describe("event-risk argument validation", () => {
  test("out-of-range args throw (the framework validates before invoke)", async () => {
    const provider = blockchainIqActionProvider({ privateKey: TEST_PRIVATE_KEY });
    await assert.rejects(() => provider.getEventRisk({ days: 0, minImportance: 1 }));
    await assert.rejects(() => provider.getEventRisk({ days: 91, minImportance: 1 }));
    await assert.rejects(() => provider.getEventRisk({ days: 7, minImportance: 0 }));
    await assert.rejects(() => provider.getEventRisk({ days: 7, minImportance: 4 }));
  });

  test("defaults are days=7, minImportance=1 in the request URL", async () => {
    const { fetch, requests } = makeStubFetch(
      () =>
        new Response(JSON.stringify({ data: { from: "2026-11-24", days: 7, events: [], highImportance: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const provider = blockchainIqActionProvider({
      privateKey: TEST_PRIVATE_KEY,
      fetchImpl: fetch,
    });
    const out = JSON.parse(await provider.getEventRisk({}));
    assert.equal(out.data.days, 7);
    assert.equal(requests.length, 1);
    assert.ok(requests[0].url.includes("days=7"));
    assert.ok(requests[0].url.includes("minImportance=1"));
  });
});

describe("paid brief flow against a stub (real 402 fixture)", () => {
  test("402 -> sign -> retry -> 200 returns data + settlement tx hash", async () => {
    const { fetch, requests } = makeStubFetch(({ headers }) => {
      if (headers["payment-signature"]) {
        return new Response(JSON.stringify(BRIEF_BODY), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "payment-response": SETTLEMENT_HEADER,
          },
        });
      }
      return new Response("Payment required", {
        status: 402,
        headers: { "payment-required": FIXTURE_402 },
      });
    });
    const provider = blockchainIqActionProvider({
      privateKey: TEST_PRIVATE_KEY,
      fetchImpl: fetch,
    });
    const out = JSON.parse(await provider.getMarketBrief({}));
    assert.equal(out.resource, BRIEF_PATH);
    assert.equal(out.priceUsd, 0.01);
    assert.equal(out.data.coins[0].symbol, "btc");
    assert.equal(out.settlement.success, true);
    assert.equal(out.settlement.transaction, SETTLEMENT_TX);
    assert.equal(out.settlement.network, "eip155:8453");
    assert.equal(out.settlement.payer, TEST_ADDRESS);
    // Pre-flight 402, wrapped initial 402, paid retry — and nothing else.
    assert.equal(requests.length, 3);
    assert.ok(requests.every((r) => r.url.endsWith(BRIEF_PATH)));
    assert.equal(requests[2].headers["payment-signature"] !== undefined, true);
    assert.equal(requests[0].headers["payment-signature"], undefined);
  });

  test("price above the cap refuses before any payment is attempted", async () => {
    const { fetch, requests } = makeStubFetch(() => {
      return new Response("Payment required", {
        status: 402,
        headers: { "payment-required": header402("5000000") }, // $5.00
      });
    });
    const provider = blockchainIqActionProvider({
      privateKey: TEST_PRIVATE_KEY,
      maxUsdPerCall: 2.0,
      fetchImpl: fetch,
    });
    const out = await provider.getMarketBrief({});
    assert.match(out, /above the per-payment cap/);
    assert.equal(requests.length, 1); // only the pre-flight probe
    assert.ok(requests.every((r) => r.headers["payment-signature"] === undefined));
  });

  test("a 200 pre-flight (free right now) returns data with null settlement", async () => {
    const { fetch, requests } = makeStubFetch(
      () =>
        new Response(JSON.stringify(BRIEF_BODY), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const provider = blockchainIqActionProvider({
      privateKey: TEST_PRIVATE_KEY,
      fetchImpl: fetch,
    });
    const out = JSON.parse(await provider.getMarketBrief({}));
    assert.equal(out.priceUsd, 0);
    assert.equal(out.settlement, null);
    assert.equal(out.data.coins[0].symbol, "btc");
    assert.equal(requests.length, 1);
  });
});

describe("header parsing", () => {
  test("priceUsdFromPaymentRequired reads the real 402 fixture as $0.01", () => {
    assert.equal(priceUsdFromPaymentRequired(FIXTURE_402), 0.01);
    assert.equal(priceUsdFromPaymentRequired(header402("5000000")), 5);
    assert.equal(priceUsdFromPaymentRequired(null), null);
    assert.equal(priceUsdFromPaymentRequired("not-base64!!!"), null);
  });

  test("parseSettlementProof decodes the settlement header; bad input -> null", () => {
    const proof = parseSettlementProof(SETTLEMENT_HEADER);
    assert.equal(proof?.transaction, SETTLEMENT_TX);
    assert.equal(proof?.success, true);
    assert.equal(proof?.network, "eip155:8453");
    assert.equal(proof?.amount, "10000");
    assert.equal(proof?.payer, TEST_ADDRESS);
    assert.equal(parseSettlementProof(null), null);
    assert.equal(parseSettlementProof("garbage"), null);
  });
});

// Live checks: free endpoints only, no wallet, no payment. Opt-in because
// they need network access to blockchainiq.co.
const LIVE = process.env.BIQ_LIVE_TESTS === "1";
describe("live free endpoints (BIQ_LIVE_TESTS=1)", { skip: !LIVE }, () => {
  test("catalogue lists brief at $0.01 and event-risk at $0.05", async () => {
    const provider = blockchainIqActionProvider();
    const out = JSON.parse(await provider.getCatalog({}));
    const byId = new Map(out.resources.map((r: { id: string }) => [r.id, r]));
    assert.equal((byId.get("brief") as { price: string }).price, "$0.01");
    assert.equal((byId.get("event-risk") as { price: string }).price, "$0.05");
  });

  test("free sample returns Bitcoin network activity, no payment", async () => {
    const res = await fetch("https://www.blockchainiq.co/api/x402/v1/sample");
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: { chain: string } };
    assert.equal(body.data.chain, "btc");
  });
});
