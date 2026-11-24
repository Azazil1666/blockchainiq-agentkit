/**
 * Constants for the Blockchain IQ x402 API.
 *
 * Sources of truth (read 2026-11-24):
 * - Free catalogue: https://www.blockchainiq.co/api/x402/v1
 * - Agent guide:    https://www.blockchainiq.co/agents
 * - Bounty terms:   https://www.blockchainiq.co/blog/x402-build-bounties
 *
 * Prices were re-read from the live catalogue on 2026-11-24. If the catalogue
 * ever disagrees with these constants, the catalogue wins — `get_catalog`
 * reads it live, and the paid actions pre-flight the real 402 price before
 * paying anything.
 */

/** Base URL of the Blockchain IQ site/API. Overridable via BLOCKCHAIN_IQ_BASE_URL. */
export const DEFAULT_BASE_URL = "https://www.blockchainiq.co";

/** x402 network: Base mainnet (CAIP-2). */
export const NETWORK = "eip155:8453" as const;
export const NETWORK_NAME = "base" as const;

/** USDC contract on Base (6 decimals). Verified against the live 402 and the x402 default-asset table. */
export const USDC_BASE_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const USDC_DECIMALS = 6;

/** Seller wallet for Blockchain IQ on Base, from the live catalogue paymentRails. */
export const PAY_TO_BASE = "0x617dA9383fbA67e86137BC4924b8b7E400fB7C9e" as const;

/** Free catalogue + sample (no payment, no wallet). */
export const CATALOG_PATH = "/api/x402/v1" as const;
export const SAMPLE_PATH = "/api/x402/v1/sample" as const;

/** The two bounty-qualifying resources (one working paid call to either qualifies). */
export const BRIEF_PATH = "/api/x402/v1/brief" as const;
export const BRIEF_PRICE_USD = 0.01;

export const EVENT_RISK_PATH = "/api/x402/v1/event-risk" as const;
export const EVENT_RISK_PRICE_USD = 0.05;

/**
 * Default per-payment cap in USD. The dearest Blockchain IQ call is $2.00
 * (analyst pack); the two bounty resources cost $0.01 and $0.05. The x402
 * client refuses any single payment above this cap, and the provider also
 * pre-flights the real 402 price before paying.
 */
export const DEFAULT_MAX_USD_PER_CALL = 2.0;

/** Name of the env var holding the dedicated wallet's hex private key. */
export const PRIVATE_KEY_ENV_VAR = "AGENT_PRIVATE_KEY";
