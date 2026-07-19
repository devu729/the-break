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

/**
 * TxLINE's SSE-style endpoint /api/scores/updates/{id} returns
 * Server-Sent-Events formatted TEXT, not JSON — blocks separated by blank
 * lines, each with a "data: {...}" line (plus "event:"/"id:" lines we
 * don't need). Axios has no built-in SSE parsing, so res.data comes back
 * as one giant raw string unless we force responseType: "text" and parse
 * it ourselves. This splits it into the individual JSON event objects.
 *
 * NOTE: /api/scores/snapshot/{id} does NOT use this format — it returns a
 * plain JSON array/object as a string. See fetchFixtureStats() below,
 * which parses that response directly and only falls back to this
 * function if direct JSON.parse fails.
 */
/**
 * /api/scores/snapshot/{id} (and /api/scores/updates/{id}) both stream a
 * sequence of incremental diffs ("Action":"action_amend"), not a single
 * full state — later records only carry the fields that changed at that
 * tick. To reconstruct a usable baseline we replay all records in order,
 * deep-merging each on top of the accumulated state, rather than reading
 * only the last record.
 */
function sortRecordsChronologically(records: any[]): any[] {
  // deepMerge below lets the LAST record in the array win for any given
  // field, so the array must actually be in chronological order for that
  // to mean "most recent wins." The API's raw array order isn't
  // guaranteed to be chronological — we saw Clock.Seconds regress
  // (e.g. reading ~40:08 right after halftime, when it should be >45:00)
  // when trusting raw array order. Sort explicitly by timestamp (Ts),
  // falling back to Seq or Id if Ts is missing, so the merge is
  // deterministic regardless of what order the API happens to send.
  return [...records].sort((a, b) => {
    const aKey = Number(a?.Ts ?? a?.Seq ?? a?.Id ?? 0);
    const bKey = Number(b?.Ts ?? b?.Seq ?? b?.Id ?? 0);
    return aKey - bKey;
  });
}

function mergeRecords(records: any[]): Record<string, any> {
  const merged: Record<string, any> = {};
  const deepMerge = (target: Record<string, any>, source: Record<string, any>) => {
    for (const key of Object.keys(source)) {
      const sVal = source[key];
      if (sVal && typeof sVal === "object" && !Array.isArray(sVal)) {
        if (!target[key] || typeof target[key] !== "object" || Array.isArray(target[key])) {
          target[key] = {};
        }
        deepMerge(target[key], sVal);
      } else {
        target[key] = sVal;
      }
    }
  };
  for (const record of records) {
    if (record && typeof record === "object") {
      deepMerge(merged, record);
    }
  }
  return merged;
}

function parseSseEvents(raw: string): any[] {
  const events: any[] = [];
  const blocks = raw.split(/\r?\n\r?\n+/);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    let dataPayload = "";
    for (const line of lines) {
      if (line.startsWith("data:")) {
        dataPayload += line.slice(5).trim();
      }
    }
    if (!dataPayload) continue;
    try {
      events.push(JSON.parse(dataPayload));
    } catch {
      // skip any malformed/partial block rather than crash the whole poll
    }
  }
  return events;
}

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
        responseType: "text",
        transformResponse: [(data) => data],
      })
    );

    if (typeof res.data === "string") {
      return sortRecordsChronologically(parseSseEvents(res.data));
    }
    return sortRecordsChronologically(
      Array.isArray(res.data) ? res.data : res.data ? [res.data] : []
    );
  }

  async fetchFixtureStats(txlineFixtureId: string): Promise<Record<string, number>> {
    const merged = await this.fetchMergedSnapshot(txlineFixtureId);
    return merged.Stats ?? merged.stats ?? {};
  }

  /**
   * Returns the current StatusId and Clock.Seconds from the same
   * merge-replayed snapshot used by fetchFixtureStats. This is more
   * reliable than reading StatusId/Clock off a single raw event from
   * fetchScoreEvents (the /updates feed), since /updates can lag behind
   * /snapshot and a single event object may not carry every field.
   */
  async fetchMatchState(txlineFixtureId: string): Promise<{ statusId: number; clockSeconds: number }> {
    const merged = await this.fetchMergedSnapshot(txlineFixtureId);
    return {
      statusId: Number(merged.StatusId ?? 0),
      clockSeconds: Number(merged.Clock?.Seconds ?? 0),
    };
  }

  private async fetchMergedSnapshot(txlineFixtureId: string): Promise<Record<string, any>> {
    const res = await this.request(() =>
      http.get(`${this.apiOrigin}/api/scores/snapshot/${txlineFixtureId}`, {
        headers: this.authHeaders(),
        timeout: 20_000,
        responseType: "text",
        transformResponse: [(data) => data],
      })
    );

    let records: any[];
    if (typeof res.data === "string") {
      // /api/scores/snapshot/{id} returns a plain JSON array/object as a
      // string, NOT SSE-formatted text like /api/scores/updates/{id}.
      // Try direct JSON.parse first; only fall back to the SSE parser if
      // that fails (e.g. if the API ever changes format on us).
      const trimmed = res.data.trim();
      if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
        try {
          const parsed = JSON.parse(trimmed);
          records = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          records = parseSseEvents(res.data);
        }
      } else {
        records = parseSseEvents(res.data);
      }
    } else {
      records = Array.isArray(res.data) ? res.data : res.data ? [res.data] : [];
    }

    return mergeRecords(sortRecordsChronologically(records));
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