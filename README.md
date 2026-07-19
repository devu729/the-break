# The Break

A synchronized prediction game tied to FIFA World Cup 2026 hydration breaks —
detected from **TxLINE's** live match data, not a countdown timer.

## Live links

- **App:** https://the-break-virid.vercel.app/
- **Worker (health check):** https://the-break-worker.onrender.com
- **Demo video:** https://youtu.be/4_odAgje5oo?si=4bft1CF0shaNQleQ

## The problem, and why this specific idea

Multiple independent fan-engagement studies converge on the same finding:
most fans already watch matches with a second screen in hand, and the
dominant behaviors on it are checking live stats and making predictions —
not reading recaps of things they already watched happen. One widely-cited
figure: roughly 68% of fans regularly check statistics *during* a live
game, and sports-tech coverage of "second screen" products repeatedly
names prediction/fantasy interactions as the top engagement format,
alongside real-time stat-checking.

That pointed us toward a prediction mechanic as the right fit for a
fan-facing hackathon track — not toward a recap, trivia, or highlight
feed, which duplicates what a fan already sees on the broadcast itself.

The hydration break is a natural hook for *when* to trigger that
prediction: it's a real, recurring pause that exists in every match, but
— importantly — it isn't on a fixed clock. It happens at the referee's
next natural stoppage after roughly the 20-minute mark of each half. That
unpredictability is what makes detecting it from live data meaningfully
harder than "wait until minute 22," and it's the actual technical core of
this project — and the reason this project leans so heavily on **TxLINE**
as a live data source rather than a scripted timer.

## The mechanic — and a real design flaw we found and fixed

**Original design:** predict whether a stat would change *during* the
3-minute break itself.

**Why that was wrong:** play is stopped during a hydration break, so a
stat like total shots almost never moves in that window. The bet was
structurally rigged toward "no change," making it a weak, mostly-obvious
guess rather than a genuine prediction.

**Fixed design:** the round opens the moment play *resumes* after the
break (baseline captured live, right as the whistle goes) and resolves a
few minutes into real, live play. The hydration break is still the
trigger — it's still the reason a round happens — but the actual bet is
on real, uncertain, live football, not frozen dead time. This was a
genuine bug caught during testing, not a hypothetical; see
`docs/KNOWN_LIMITATIONS.md` for the full note.

## How it's wired together

```
Next.js frontend (Vercel)  ⇄  Supabase (Postgres + Realtime)  ⇐  worker (Render, always-on)
                                                                     ⇑
                                                                  TxLINE (live match data)
```

The worker is the only long-running process — it polls **TxLINE**, detects
the break-then-resume transition, and writes rows to Supabase. The
frontend never talks to the worker or to TxLINE directly; it subscribes to
Supabase Realtime on the `rounds` table, which pushes every INSERT/UPDATE
to all connected browsers instantly. Full rationale in `docs/ARCHITECTURE.md`.

Players connect a **Solana devnet** wallet (no real money, ever, at any
point in the flow) instead of a username/password. Streaks and a
leaderboard persist per-wallet in Supabase.

## TxLINE integration — the actual core of this build

Everything the game does — when a round opens, what stat it's about, when
it resolves — depends on correctly reading TxLINE's live match feed. That
integration was the hardest and least documented part of the project, and
most of the real debugging time went here rather than into the frontend or
Solana side. Specifics, not just a claim:

- **Soccer phase codes are `H1`/`H2`/`HT`**, confirmed directly against
  TxLINE's real Scores schema — not `1H`/`2H` as first assumed from
  generic sports-API conventions. Getting this wrong wouldn't have thrown
  an error; it would have let the app run indefinitely while break
  detection silently never fired.
- **The event-type field is called `action`, not `type`** — another
  silent-mismatch risk rather than a crash risk.
- **The exact set of possible `action` values isn't enumerated anywhere in
  TxLINE's docs.** `STOPPAGE_EVENT_TYPES` in `breakDetector.ts` is an
  educated guess built from observed live data, not a documented
  contract. A 5-minute fallback timer guarantees a round still opens even
  if that guess turns out wrong, at the cost of being less precisely tied
  to the exact stoppage moment.
- **No documented soccer match-minute field.** Only US Football has an
  explicit `clock` object in TxLINE's schema. Elapsed match time here is
  approximated from wall-clock time since kickoff, which doesn't account
  for stoppage time — stated plainly as an approximation, not corrected
  data.
- **The `stats` map uses numeric keys with no confirmed name mapping.**
  Rather than guess which key means "shots" (and risk silently labeling
  the wrong stat), the round manager picks whichever real numeric stat is
  actually present at round-open time. Correct and honest, but means the
  specific stat shown varies rather than always being a fixed one like
  "shots."
- **The IDL's `address` field was hardcoded to TxLINE's mainnet program
  ID**, even in the file meant for devnet use. Anchor 0.30+ reads that
  field to pick which on-chain program to call — using it as-is would have
  silently pointed every transaction at the wrong program. Fixed by
  overriding it to the configured network's program ID at runtime, with a
  matching assertion as a safety net.
- **The `subscribe()` free-tier transaction still debits a token account
  that has to exist first**, even for a zero-cost debit — a fresh wallet
  doesn't have one. Fixed by checking for it and creating it via
  `createAssociatedTokenAccountInstruction` before ever calling
  `subscribe()`.
- **A Windows/Node IPv6 connectivity issue** meant some requests to
  TxLINE's devnet host would hang indefinitely trying unreachable IPv6
  addresses. Fixed with a dedicated DNS resolver pointed at known-good
  public resolvers (9.9.9.9, 8.8.8.8, 1.1.1.1), bypassing an unreliable
  local system resolver.

None of these were guessed in advance — each was hit while building
against the real TxLINE devnet feed and fixed against TxLINE's actual
schema/docs, not assumed from other sports APIs. Full endpoint-by-endpoint
detail, including the exact TxLINE docs pages each fix was confirmed
against, is in `docs/TXLINE_ENDPOINTS.md` (this file also doubles as the
hackathon's required TxLINE feedback writeup).

**What this integration is not:** it's not a full wrapper around TxLINE's
API surface, and it doesn't handle every sport or league TxLINE exposes —
it's scoped to exactly what soccer hydration-break detection needs.

## Solana — devnet only, and kept deliberately narrow

Solana's role here is narrow and intentional: a wallet is the identity
layer (no username/password), and a **devnet**-only token flow backs the
free-tier `subscribe()` call the worker makes against TxLINE. There is no
real-money path anywhere in this repo.

- **Devnet only, enforced at runtime** in both
  `frontend/lib/solanaConfig.ts` and `worker/src/config.ts` — not just a
  config default, but a checked constraint.
- **Overlapping poll ticks** in the worker (a slow tick colliding with the
  next scheduled one, silently stacking async work over time) were fixed
  by replacing `setInterval` with a recursive `setTimeout` that only
  schedules the next tick after the current one fully completes.
- All Solana wallet-adapter packages come from the `anza-xyz` org
  (verified current — `solana-labs` is the archived predecessor).

Devnet SOL held in a wallet is transaction-fee/subscription gas, not a
score. It's unrelated to a player's prediction streak.

## Known limitations — stated plainly, not oversold

- TxLINE's `action` event values and numeric `stats` keys aren't fully
  documented (see above) — both are worked around, not solved.
- Match-minute is approximated from wall-clock time, not read from a
  documented clock field.
- **Anti-cheat is minimal.** Grading happens via the worker's
  service-role key, which is correct, but there's no protection against
  a player running multiple wallets to hedge both directions on one
  round.
- **Single worker instance assumed.** Break-tracking state is in-memory;
  running two worker instances concurrently could race to open duplicate
  rounds.
- **Leaderboard is global only** — no per-match or per-tournament
  breakdown yet.

Full list, including production-fix notes for each: `docs/KNOWN_LIMITATIONS.md`.

## Repo layout

- `frontend/` — Next.js App Router site, deployed to Vercel
- `worker/` — always-on Node/TypeScript process, deployed to Render (includes a minimal HTTP health-check endpoint so Render's free web-service tier stays up, and so uptime pingers have something to hit)
- `supabase/schema.sql` — run once against a fresh Supabase project
- `docs/` — architecture notes, TxLINE integration notes (doubles as the hackathon's required feedback writeup), known limitations

## Setup instructions

### 1. Supabase
1. Create a free project at supabase.com.
2. Open the SQL Editor, paste the full contents of `supabase/schema.sql`, run it. This creates all 5 tables, enables Realtime on `rounds`/`predictions`, and sets up Row Level Security policies.
3. From Project Settings → API, copy: Project URL, `anon` public key, `service_role` secret key.

### 2. Wallets (Solana devnet — never mainnet)
1. Generate a worker wallet:
   ```
   node -e "const {Keypair}=require('@solana/web3.js'); const kp=Keypair.generate(); console.log('ADDRESS:', kp.publicKey.toBase58()); console.log('SECRET_KEY_JSON:', JSON.stringify(Array.from(kp.secretKey)));"
   ```
   (run from inside `worker/` after `npm install`, so the package is available)
2. Fund it with devnet SOL from a faucet (e.g. faucet.solana.com — connect GitHub for a higher rate limit if the base limit is exhausted).
3. Install a browser wallet (e.g. Phantom) for players, switch it to Devnet.

### 3. TxLINE IDL
Pull `txoracle.json` and `txoracle.ts` from TxLINE's "Runnable Devnet Examples" page and place them in `worker/src/txline/idl/` — not vendored in this repo since a stale copy would silently break transactions.

### 4. Environment files
- Copy `worker/.env.example` → `worker/.env`, fill in Supabase URL, `service_role` key, worker wallet's secret key array, and TxLINE config.
- Copy `frontend/.env.local.example` → `frontend/.env.local`, fill in Supabase URL and `anon` key only (never the service_role key here).

### 5. Run locally
```
cd worker && npm install && npm run dev
cd frontend && npm install && npm run dev
```

### 6. Deploy
- **Frontend → Vercel**: import the repo, set Root Directory to `frontend`, add the 4 env vars from `.env.local`, deploy.
- **Worker → Render**: new Web Service, Root Directory `worker`, Build Command `npm install && npm run build`, Start Command `npm start`, Free instance, add all env vars from `.env`, Health Check Path `/`.
- Optional: point an uptime pinger (e.g. UptimeRobot, 5-minute interval) at the Render URL to keep the free instance from spinning down after inactivity.

## Hard constraints this repo respects

- Zero budget, no paid tier anywhere, no credit card required.
- Solana **devnet only** — never mainnet, enforced at runtime in both `frontend/lib/solanaConfig.ts` and `worker/src/config.ts`.
- No custom WebSocket server — Supabase Realtime does that job.
- All Solana wallet-adapter packages come from `anza-xyz` (verified current, not the archived `solana-labs` org).