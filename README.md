# blockchainiq-agentkit

Coinbase AgentKit action provider for the [Blockchain IQ](https://www.blockchainiq.co)
pay-per-call crypto data API — market data bought one request at a time over
the open [x402](https://www.x402.org/) standard, paid in USDC on Base.
No account, no API key: a wallet holding a little USDC is the only credential.

Built for the [Blockchain IQ x402 build bounties](https://www.blockchainiq.co/blog/x402-build-bounties)
(Coinbase AgentKit slot, $525 USDC total across four frameworks, round closes
31 Dec 2026 11:59 PM Central).

## Actions

| Action | Price | What it does |
| --- | --- | --- |
| `get_catalog` | free | List every x402 resource with path + price. No wallet needed. |
| `get_market_brief` | **$0.01** | BTC/ETH/SOL/XRP prices with 24h/7d/30d moves, events in the next 48h, risk flags. Parameter-free. |
| `get_event_risk` | **$0.05** | Scheduled market-moving events for the next N days (`days` 1–90, default 7; `minImportance` 1–3, default 1). |

Every paid action returns the data **plus the settlement proof** — the Base
transaction hash from the `PAYMENT-RESPONSE` header — so the call is auditable
and the bounty claim can cite it.

## Install

```bash
npm install blockchainiq-agentkit
# peer deps (installed automatically as dependencies):
# @coinbase/agentkit, @x402/fetch, @x402/evm, @x402/core, viem, zod
```

Requires Node 18+.

## Setup

The paying wallet is a **dedicated throwaway wallet** holding a little USDC on
Base — never a main wallet. Only its hex private key is needed; it is never
logged and never leaves your machine except as a local signature.

```bash
cp .env.example .env
# edit .env:
AGENT_PRIVATE_KEY=0x...   # dedicated wallet, small USDC balance on Base
MAX_USD_PER_CALL=2.00     # optional; default 2.00 (the dearest BIQ call)
```

## Usage (AgentKit)

```ts
import { AgentKit } from "@coinbase/agentkit";
import { blockchainIqActionProvider } from "blockchainiq-agentkit";

const agentKit = await AgentKit.from({
  walletProvider, // any AgentKit WalletProvider, e.g. ViemWalletProvider
  actionProviders: [blockchainIqActionProvider()],
});

const actions = agentKit.getActions();
// get_catalog, get_market_brief, get_event_risk
```

Standalone (no AgentKit instance needed):

```ts
import { blockchainIqActionProvider } from "blockchainiq-agentkit";

const provider = blockchainIqActionProvider(); // reads AGENT_PRIVATE_KEY
console.log(await provider.getCatalog({})); // free
console.log(await provider.getMarketBrief({})); // $0.01, needs a funded key
console.log(await provider.getEventRisk({ days: 14 })); // $0.05
console.log(provider.getPayerAddress()); // payout address for the claim
```

Try it: `npm run example` (works with no key — paid calls refuse cleanly).

## How a paid call works

1. Plain `GET` to the resource. The reply is HTTP `402` with a
   `PAYMENT-REQUIRED` header (base64 JSON: price, asset USDC, network
   `eip155:8453`, pay-to address).
2. **Pre-flight cap check** — the provider reads the real 402 price and
   refuses before paying if it is above `MAX_USD_PER_CALL`. A 402 is never
   charged, so this read is free.
3. The x402 client signs a USDC payment (EIP-3009, gasless for the payer)
   and retries with it, under the same spend cap (`spendControls`).
4. HTTP `200` with JSON, plus a `PAYMENT-RESPONSE` header carrying the
   settlement transaction hash. A 404 or any error response is never charged.

Seller on Base: `0x617dA9383fbA67e86137BC4924b8b7E400fB7C9e`
(x402 v2, facilitator: Coinbase CDP).

## Safety

- No key configured → paid actions return a clear error and make **zero**
  network requests. Free actions still work.
- Per-payment cap enforced twice (pre-flight 402 read + x402 spend controls).
- `.env`, keys and `node_modules/` are gitignored. No secret is ever
  committed, logged, or printed.

## Tests

```bash
npm test            # stubbed, deterministic — no paid call, no funded wallet
BIQ_LIVE_TESTS=1 npm test   # + live free-endpoint checks (catalogue, sample)
npm run build       # tsc, strict, emits dist/ + declarations
```

The paid-flow test replays a **real HTTP 402 header captured from the live
API** (`test/fixtures-402-header.txt`) through a recording stub fetch, so it
exercises the true sign → retry → settle path with a throwaway test key.

## Claim checklist (bounty)

- [ ] Public repo URL: `https://github.com/<owner>/blockchainiq-agentkit`
- [ ] One successful paid call — cheapest is `get_market_brief` ($0.01)
- [ ] Settlement tx hash from the action output (`settlement.transaction`)
- [ ] Payout address (USDC on Base) — `provider.getPayerAddress()`
- [ ] Email `partnerships@blockchainiq.co` — see `CLAIM.md` for the draft

Claims are checked in inbox-arrival order; the first passing claim takes
$150, the next three $125 each. One builder can claim at most two slots.

## License

MIT.
