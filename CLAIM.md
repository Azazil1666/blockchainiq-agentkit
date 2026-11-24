# Claim — Blockchain IQ x402 build bounty (Coinbase AgentKit slot)

DO NOT SEND until every placeholder is filled with a REAL value from a
successful paid call. This file is a draft template only — nothing here
has been sent.

## Checklist (all must be true before sending)

- [ ] Repo is PUBLIC at the URL below (push first — never push a key or .env)
- [ ] One paid call succeeded via the provider (cheapest: `get_market_brief`, $0.01)
- [ ] Settlement tx hash copied from the action output (`settlement.transaction`)
- [ ] Payout address is a USDC-on-Base address you control
      (use `provider.getPayerAddress()` — the wallet that paid for the call)

## Draft email

- **To:** partnerships@blockchainiq.co
- **Subject:** x402 bounty claim — Coinbase AgentKit action provider (blockchain-iq)

> Hi Jeremy,
>
> Claiming the Coinbase AgentKit slot of the x402 build bounties.
>
> - Framework: Coinbase AgentKit (action provider `blockchain-iq`)
> - Public repo: https://github.com/<OWNER>/blockchainiq-agentkit
>   (commit: <COMMIT_SHA>)
> - Qualifying paid call: `get_market_brief` ($0.01) via x402 on Base
> - Settlement transaction hash: 0x<SETTLEMENT_TX_HASH>
>   (Base, viewable at https://basescan.org/tx/0x<SETTLEMENT_TX_HASH>)
> - Payout address (USDC on Base): 0x<PAYOUT_ADDRESS>
>
> The provider exposes three actions — `get_catalog` (free),
> `get_market_brief` ($0.01) and `get_event_risk` ($0.05) — with the
> settlement proof (tx hash) returned in every paid action's output.
> Setup and the test run are in the repo README; `npm test` passes with
> no funded wallet (paid flows run against a stub replaying a real 402).
>
> Thanks,
> <YOUR NAME>

## After sending

- Claims are checked in inbox-arrival order; a failed claim goes to the back
  of the line when a corrected version is sent. Double-check the repo is
  public and the tx hash is real before sending.
- Payment (if the claim passes): $150 for the first passing claim overall,
  $125 for each of the next three, in USDC on Base, within 3 days.
- Round closes 31 Dec 2026 11:59 PM Central; unclaimed slots lapse.
