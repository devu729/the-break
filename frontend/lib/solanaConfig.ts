import { clusterApiUrl } from "@solana/web3.js";

// Hard constraint: devnet only, everywhere in this project.
export const SOLANA_NETWORK = "devnet" as const;

export const SOLANA_RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? clusterApiUrl(SOLANA_NETWORK);
