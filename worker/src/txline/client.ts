/**
 * TxLINE client — devnet guest auth, on-chain free-tier subscription, and
 * API token activation.
 */

import * as anchor from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import axios from "axios";
import dns from "node:dns";
import https from "node:https";
import nacl from "tweetnacl";
import { env } from "../config.js";
import type { Txoracle } from "./idl/txoracle.js";
import txoracleIdl from "./idl/txoracle.json" with { type: "json" };

const caresResolver = new dns.Resolver();
caresResolver.setServers(["9.9.9.9", "8.8.8.8", "1.1.1.1"]);

function resolveViaCares(
  hostname: string,
  options: { all?: boolean } | ((err: NodeJS.ErrnoException | null, ...args: any[]) => void),
  callback?: (err: NodeJS.ErrnoException | null, ...args: any[]) => void
): void {
  const opts = typeof options === "object" && options !== null ? options : {};
  const cb = typeof options === "function" ? options : callback!;

  caresResolver.resolve4(hostname, (err4, addresses4) => {
    const v4 = !err4 && addresses4 ? addresses4.map((address) => ({ address, family: 4 })) : [];
    caresResolver.resolve6(hostname, (err6, addresses6) => {
      const v6 = !err6 && addresses6 ? addresses6.map((address) => ({ address, family: 6 })) : [];
      const all = [...v4, ...v6];

      if (all.length === 0) {
        cb(err4 ?? err6 ?? new Error(`resolveViaCares: no records for ${hostname}`));
        return;
      }
      if (opts.all) {
        cb(null, all);
      } else {
        cb(null, all[0].address, all[0].family);
      }
    });
  });
}

const txlineHttpsAgent = new https.Agent({
  lookup: resolveViaCares,
  keepAlive: true,
});

const http = axios.create({ httpsAgent: txlineHttpsAgent });

export interface TxLineCredentials {
  jwt: string;
  apiToken: string;
}

export class TxLineClient {
  private connection: Connection;
  private wallet: Keypair;
  private programId: PublicKey;
  private txlTokenMint: PublicKey;
  private apiOrigin: string;
  private credentials: TxLineCredentials | null = null;

  constructor() {
    this.connection = new Connection(env.SOLANA_RPC_URL, "confirmed");
    this.wallet = env.workerKeypair;
    this.programId = new PublicKey(env.TXLINE_PROGRAM_ID);
    this.txlTokenMint = new PublicKey(env.TXLINE_TOKEN_MINT);
    this.apiOrigin = env.TXLINE_API_ORIGIN;
  }

  private async getGuestJwt(): Promise<string> {
    const res = await http.post(`${this.apiOrigin}/auth/guest/start`);
    return res.data.token;
  }

  async ensureEntitlement(): Promise<TxLineCredentials> {
    if (this.credentials) return this.credentials;

    const provider = new anchor.AnchorProvider(
      this.connection,
      new anchor.Wallet(this.wallet),
      { commitment: "confirmed" }
    );
    anchor.setProvider(provider);

    const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_treasury_v2")],
      this.programId
    );
    const tokenTreasuryVault = getAssociatedTokenAddressSync(
      this.txlTokenMint,
      tokenTreasuryPda,
      true,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const [pricingMatrixPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("pricing_matrix")],
      this.programId
    );
    const userTokenAccount = getAssociatedTokenAddressSync(
      this.txlTokenMint,
      this.wallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const idlForNetwork = { ...txoracleIdl, address: this.programId.toBase58() };
    const program = new anchor.Program(idlForNetwork as unknown as Txoracle, provider);

    if (!program.programId.equals(this.programId)) {
      throw new Error(
        `Loaded IDL program ${program.programId.toBase58()} does not match configured program ${this.programId.toBase58()}`
      );
    }

    const existingAccountInfo = await this.connection.getAccountInfo(userTokenAccount);
    if (!existingAccountInfo) {
      const createAtaIx = createAssociatedTokenAccountInstruction(
        this.wallet.publicKey,
        userTokenAccount,
        this.wallet.publicKey,
        this.txlTokenMint,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      const createAtaTx = new Transaction().add(createAtaIx);
      await provider.sendAndConfirm(createAtaTx);
    }

    const selectedLeagues: number[] = [];
    const txSig: string = await program.methods
      .subscribe(env.TXLINE_SERVICE_LEVEL_ID, env.TXLINE_SUBSCRIPTION_WEEKS)
      .accounts({
        user: this.wallet.publicKey,
        pricingMatrix: pricingMatrixPda,
        tokenMint: this.txlTokenMint,
        userTokenAccount,
        tokenTreasuryVault,
        tokenTreasuryPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const jwt = await this.getGuestJwt();

    const messageString = `${txSig}:${selectedLeagues.join(",")}:${jwt}`;
    const message = new TextEncoder().encode(messageString);
    const signatureBytes = nacl.sign.detached(message, this.wallet.secretKey);
    const walletSignature = Buffer.from(signatureBytes).toString("base64");

    const activation = await http.post(
      `${this.apiOrigin}/api/token/activate`,
      { txSig, walletSignature, leagues: selectedLeagues },
      { headers: { Authorization: `Bearer ${jwt}` } }
    );

    const apiToken = activation.data.token ?? activation.data;
    this.credentials = { jwt, apiToken };
    return this.credentials;
  }

  async renewJwt(): Promise<void> {
    if (!this.credentials) return;
    this.credentials.jwt = await this.getGuestJwt();
  }

  private authHeaders() {
    if (!this.credentials) throw new Error("Call ensureEntitlement() first");
    return {
      Authorization: `Bearer ${this.credentials.jwt}`,
      "X-Api-Token": this.credentials.apiToken,
    };
  }

  async fetchFixtures(startEpochDay?: number, competitionId?: number): Promise<unknown[]> {
    const res = await this.request(() =>
      http.get(`${this.apiOrigin}/api/fixtures/snapshot`, {
        params: {
          ...(startEpochDay !== undefined ? { startEpochDay } : {}),
          ...(competitionId !== undefined ? { competitionId } : {}),
        },
        headers: this.authHeaders(),
        timeout: 20_000,
      })
    );
    return res.data ?? [];
  }

  async fetchScoreEvents(txlineFixtureId: string): Promise<unknown[]> {
    const res = await this.request(() =>
      http.get(`${this.apiOrigin}/api/scores/updates/${txlineFixtureId}`, {
        headers: this.authHeaders(),
        timeout: 20_000,
      })
    );
    return Array.isArray(res.data) ? res.data : res.data ? [res.data] : [];
  }

  async fetchFixtureStats(txlineFixtureId: string): Promise<Record<string, number>> {
    const res = await this.request(() =>
      http.get(`${this.apiOrigin}/api/scores/snapshot/${txlineFixtureId}`, {
        headers: this.authHeaders(),
        timeout: 20_000,
      })
    );
    const record = Array.isArray(res.data) ? res.data[res.data.length - 1] : res.data;
    return record?.stats ?? {};
  }

  private async request<T>(fn: () => Promise<T>): Promise<T> {
    const NETWORK_ERROR_CODES = new Set([
      "ETIMEDOUT",
      "ECONNRESET",
      "ECONNREFUSED",
      "ENOTFOUND",
      "EAI_AGAIN",
      "ECONNABORTED",
    ]);
    const maxNetworkRetries = 3;

    let lastErr: any;
    for (let attempt = 0; attempt <= maxNetworkRetries; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        lastErr = err;
        if (err?.response?.status === 401) {
          await this.renewJwt();
          continue;
        }
        const isNetworkError = NETWORK_ERROR_CODES.has(err?.code) || NETWORK_ERROR_CODES.has(err?.cause?.code);
        if (isNetworkError && attempt < maxNetworkRetries) {
          const delayMs = 1000 * Math.pow(2, attempt);
          console.warn(
            `[txline] network error (${err?.code ?? err?.cause?.code}), retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxNetworkRetries})`
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }
}
