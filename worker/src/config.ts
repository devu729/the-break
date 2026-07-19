import "dotenv/config";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function loadWorkerKeypair(): Keypair {
  const raw = required("WORKER_WALLET_SECRET_KEY");
  // Accept either a JSON array (e.g. from `solana-keygen new --outfile -`)
  // or a base58 string (e.g. from Phantom's "export private key").
  try {
    const arr = JSON.parse(raw);
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  } catch {
    return Keypair.fromSecretKey(bs58.decode(raw));
  }
}

export const env = {
  SUPABASE_URL: required("SUPABASE_URL"),
  SUPABASE_SERVICE_ROLE_KEY: required("SUPABASE_SERVICE_ROLE_KEY"),

  SOLANA_NETWORK: process.env.SOLANA_NETWORK ?? "devnet",
  SOLANA_RPC_URL: process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
  workerKeypair: loadWorkerKeypair(),

  TXLINE_API_ORIGIN: process.env.TXLINE_API_ORIGIN ?? "https://txline-dev.txodds.com",
  TXLINE_PROGRAM_ID: required("TXLINE_PROGRAM_ID"),
  TXLINE_TOKEN_MINT: required("TXLINE_TOKEN_MINT"),
  TXLINE_SERVICE_LEVEL_ID: Number(process.env.TXLINE_SERVICE_LEVEL_ID ?? 1),
  TXLINE_SUBSCRIPTION_WEEKS: Number(process.env.TXLINE_SUBSCRIPTION_WEEKS ?? 4),

  POLL_INTERVAL_MS: Number(process.env.POLL_INTERVAL_MS ?? 15_000),
  BREAK_MINUTE_THRESHOLD: Number(process.env.BREAK_MINUTE_THRESHOLD ?? 20),
};

if (env.SOLANA_NETWORK !== "devnet") {
  // Hard constraint from the project brief: devnet only, always.
  throw new Error(
    `SOLANA_NETWORK is "${env.SOLANA_NETWORK}" — this project must only ever run on devnet.`
  );
}
