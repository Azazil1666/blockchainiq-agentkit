import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";
import {
  DEFAULT_MAX_USD_PER_CALL,
  NETWORK,
  USDC_BASE_ADDRESS,
  USDC_DECIMALS,
} from "./constants.js";
import type { SettlementProof } from "./types.js";

/**
 * Build a fetch that pays for x402 resources automatically.
 *
 * Flow (x402 v2, USDC on Base): plain GET -> HTTP 402 with a
 * PAYMENT-REQUIRED header -> the client signs a USDC payment for that amount
 * -> retry with the payment -> HTTP 200 + PAYMENT-RESPONSE header carrying
 * the settlement tx hash. A 404 or any error response is never charged, and
 * settlement is gasless for the payer.
 *
 * Spend control: the client refuses any single payment above `maxUsdPerCall`
 * (default $2.00 — the dearest Blockchain IQ call). The private key is used
 * only to build the viem signer; it is never logged or sent anywhere except
 * as a local signature.
 */
export function buildPaidFetch(
  privateKey: string,
  maxUsdPerCall: number = DEFAULT_MAX_USD_PER_CALL,
  baseFetch: typeof fetch = fetch,
): typeof fetch {
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const client = x402Client.fromConfig({
    schemes: [
      {
        network: NETWORK,
        client: new ExactEvmScheme(account),
      },
    ],
    spendControls: { maxAmountPerPayment: maxUsdPerCall },
  });
  return wrapFetchWithPayment(baseFetch, client);
}

/**
 * Decode the PAYMENT-RESPONSE header of a settled call into proof of
 * settlement. Returns null when there is no header (unpaid/free response)
 * or the header does not decode.
 */
export function parseSettlementProof(header: string | null | undefined): SettlementProof | null {
  if (!header) {
    return null;
  }
  try {
    const decoded = decodePaymentResponseHeader(header) as unknown as Record<
      string,
      unknown
    >;
    if (typeof decoded.transaction !== "string" || !decoded.transaction) {
      return null;
    }
    return {
      success: decoded.success === true,
      transaction: decoded.transaction,
      network: typeof decoded.network === "string" ? decoded.network : NETWORK,
      amount: typeof decoded.amount === "string" ? decoded.amount : "",
      payer: typeof decoded.payer === "string" ? decoded.payer : "",
    };
  } catch {
    return null;
  }
}

/**
 * Read the USD price from an HTTP 402 PAYMENT-REQUIRED header: the cheapest
 * Base/USDC option the server accepts, converted from atomic USDC (6 decimals).
 * Returns null when the header is missing, undecodable, or has no Base/USDC
 * option. Used for the pre-flight cap check — the header itself is free to
 * read; a 402 is never charged.
 */
export function priceUsdFromPaymentRequired(
  header: string | null | undefined,
): number | null {
  if (!header) {
    return null;
  }
  try {
    const decoded = decodePaymentRequiredHeader(header) as unknown as {
      accepts?: Array<{
        network?: string;
        asset?: string;
        amount?: string;
      }>;
    };
    const options = Array.isArray(decoded.accepts) ? decoded.accepts : [];
    const baseUsdc =
      options.find(
        (a) =>
          a.network === NETWORK &&
          typeof a.asset === "string" &&
          a.asset.toLowerCase() === USDC_BASE_ADDRESS.toLowerCase(),
      ) ?? options[0];
    if (!baseUsdc || typeof baseUsdc.amount !== "string") {
      return null;
    }
    const atomic = Number(baseUsdc.amount);
    if (!Number.isFinite(atomic) || atomic < 0) {
      return null;
    }
    return atomic / 10 ** USDC_DECIMALS;
  } catch {
    return null;
  }
}
