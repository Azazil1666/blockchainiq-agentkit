/**
 * Response shapes for the Blockchain IQ x402 API.
 * Shapes were read from the free catalogue's `returns`/`discovery` fields
 * (https://www.blockchainiq.co/api/x402/v1) on 2026-11-24.
 */

/** One coin in the market brief. */
export interface BriefCoin {
  coinId: string;
  symbol: string;
  price: number;
  change24h: number;
  change7d: number;
  change30d: number;
  marketCapRank: number;
  /** "biq" = Blockchain IQ's own DEX-pool price (used for XRP); "coingecko" otherwise. */
  priceSource: string;
}

export interface BriefEvent {
  date: string;
  /** US Eastern time, HH:MM, or null. */
  time: string | null;
  title: string;
  category: string;
  importance: number;
}

/** `data` of GET /api/x402/v1/brief ($0.01, parameter-free). */
export interface BriefData {
  asOf: string;
  coins: BriefCoin[];
  events: BriefEvent[];
  /** Short risk-flag strings. */
  flags: string[];
}

export interface EventRiskEvent {
  id: string;
  date: string;
  /** US Eastern time, HH:MM, or null. */
  time: string | null;
  category: "Macro" | "Monetary" | "Treasury" | "Regulatory" | "Crypto" | string;
  region: string;
  title: string;
  /** 1-3. */
  importance: number;
  firm: boolean;
  source: string;
  sourceUrl: string;
}

/** `data` of GET /api/x402/v1/event-risk ($0.05). */
export interface EventRiskData {
  from: string;
  days: number;
  events: EventRiskEvent[];
  highImportance: EventRiskEvent[];
}

/** One entry of the free catalogue. */
export interface CatalogResource {
  id: string;
  method: string;
  path: string;
  price: string;
  title: string;
  description: string;
}

/**
 * Proof of settlement, decoded from the PAYMENT-RESPONSE header of a paid call.
 * `transaction` is the on-chain tx hash — the value the bounty claim needs.
 */
export interface SettlementProof {
  success: boolean;
  /** Base tx hash, e.g. 0x.... */
  transaction: string;
  network: string;
  /** Atomic USDC amount paid (6 decimals), as a string. */
  amount: string;
  /** Payer wallet address. */
  payer: string;
}

/** What a paid action returns (JSON-stringified by the action). */
export interface PaidCallResult<TData> {
  resource: string;
  priceUsd: number;
  data: TData;
  /** Null when the resource came back free (e.g. a free-until promo). */
  settlement: SettlementProof | null;
}

/** Options for {@link BlockchainIqActionProvider}. */
export interface BlockchainIqProviderOptions {
  /**
   * Hex private key (0x...) of the DEDICATED wallet that pays for calls.
   * Defaults to the AGENT_PRIVATE_KEY env var. A throwaway wallet holding a
   * little USDC on Base — never a main wallet. The key is never logged.
   * When absent, paid actions refuse with a clear error and free actions
   * still work.
   */
  privateKey?: string;
  /** Per-payment cap in USD. Default 2.00 (the dearest Blockchain IQ call). */
  maxUsdPerCall?: number;
  /** API base URL. Default https://www.blockchainiq.co. */
  baseUrl?: string;
  /** fetch implementation (injectable for tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}
