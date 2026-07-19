import http from "node:http";
import { TxLineClient } from "./txline/client.js";
import { startPolling } from "./txline/poller.js";

// Render's free tier is a "Web Service" — it expects something bound to
// $PORT and responding to HTTP requests, or it may consider the deploy
// unhealthy. This worker is otherwise a pure background process with no
// HTTP server of its own, so this is the minimal thing needed to satisfy
// that requirement. It also gives UptimeRobot (or any other pinger) a
// real endpoint to hit to keep the free instance from spinning down after
// inactivity.
function startHealthServer() {
  const port = Number(process.env.PORT ?? 3001);
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "the-break-worker" }));
  });
  server.listen(port, () => {
    console.log(`[worker] health check server listening on port ${port}`);
  });
}

async function main() {
  console.log("[worker] starting The Break worker (devnet)");
  startHealthServer();
  const client = new TxLineClient();
  await startPolling(client);
}

main().catch((err) => {
  console.error("[worker] fatal error:", err);
  process.exit(1);
});