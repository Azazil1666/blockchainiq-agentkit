/**
 * Quickstart for the Blockchain IQ AgentKit provider.
 *
 * Run:  npm run example
 *   - with no key: lists the free catalogue and shows the paid actions
 *     refusing cleanly (nothing is called, nothing is charged).
 *   - with AGENT_PRIVATE_KEY set (a dedicated wallet with a little USDC on
 *     Base): buys the $0.01 market brief and prints the settlement proof.
 *
 * AgentKit wiring (needs a wallet provider for the framework side — any
 * WalletProvider works, e.g. ViemWalletProvider):
 *
 *   import { AgentKit } from "@coinbase/agentkit";
 *   import { blockchainIqActionProvider } from "blockchainiq-agentkit";
 *
 *   const agentKit = await AgentKit.from({
 *     walletProvider,
 *     actionProviders: [blockchainIqActionProvider()],
 *   });
 *   const actions = agentKit.getActions(); // get_catalog, get_market_brief, get_event_risk
 */
import { blockchainIqActionProvider } from "../dist/index.js";

async function main(): Promise<void> {
  const provider = blockchainIqActionProvider();
  console.log(`provider: ${provider.name}`);
  console.log(`wallet configured: ${provider.hasWallet()}`);
  console.log(`payer address: ${provider.getPayerAddress() ?? "(none — set AGENT_PRIVATE_KEY)"}`);
  console.log();

  const actions = provider.getActions({} as never);
  console.log("actions:");
  for (const action of actions) {
    console.log(`  - ${action.name}: ${action.description.slice(0, 90)}...`);
  }
  console.log();

  console.log("== free catalogue ==");
  console.log(await provider.getCatalog({}));
  console.log();

  console.log("== market brief ($0.01) ==");
  console.log(await provider.getMarketBrief({}));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
