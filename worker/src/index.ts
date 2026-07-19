import { TxLineClient } from "./txline/client.js";
import { startPolling } from "./txline/poller.js";

async function main() {
  console.log("[worker] starting The Break worker (devnet)");
  const client = new TxLineClient();
  await startPolling(client);
}

main().catch((err) => {
  console.error("[worker] fatal error:", err);
  process.exit(1);
});
