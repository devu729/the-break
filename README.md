# The Break

A synchronized prediction game tied to FIFA World Cup 2026 hydration breaks.
When the referee calls the real hydration break — detected from TxLINE's
live match-event feed, not a countdown timer — every connected player on
that match gets the same Hi-Lo round at the same moment. Sign in with a
Solana wallet (devnet), build a streak, climb the leaderboard.

Full build brief and hard constraints: see the original prompt this repo was
generated from. Short version: **zero budget, devnet-only, no custom
WebSocket server.**

## How it's wired together

```
Next.js frontend (Vercel)  ⇄  Supabase (Postgres + Realtime)  ⇐  worker (Render, always-on)
```

The worker is the only long-running process — it polls TxLINE, detects
breaks, and writes rows to Supabase. The frontend never talks to the worker
directly; it subscribes to Supabase Realtime on the `rounds` table, which
pushes every INSERT/UPDATE to all connected browsers. Full rationale in
`docs/ARCHITECTURE.md`.

## Repo layout

- `frontend/` — Next.js App Router site, deployed to Vercel
- `worker/` — always-on Node/TypeScript process, deployed to Render
- `supabase/schema.sql` — run this once against a fresh Supabase project
- `docs/` — architecture notes, TxLINE integration notes, known limitations

## Getting it running

1. **Supabase**: create a free project, run `supabase/schema.sql` in the SQL
   editor. Copy the project URL + anon key (for the frontend) and the
   service-role key (for the worker) — see `.env.local.example` /
   `.env.example` in each package.
2. **Worker wallet**: generate a devnet keypair (`solana-keygen new`), fund
   it at https://faucet.solana.com, and set `WORKER_WALLET_SECRET_KEY`.
3. **TxLINE IDL**: drop the current `txoracle.json` IDL into
   `worker/src/txline/idl/` — see the README there for why it isn't
   vendored in this repo.
4. **Confirm endpoints**: the worker's `fetchLiveMatches` /
   `fetchMatchEvents` / `fetchMatchStats` calls use best-effort REST paths.
   Confirm the real paths against TxLINE's API Reference before relying on
   this in a demo — see `docs/TXLINE_ENDPOINTS.md`.
5. `cd worker && npm install && npm run dev`
6. `cd frontend && npm install && npm run dev`
7. Deploy: frontend → Vercel (free tier), worker → Render (free tier, no
   card at signup at time of writing — reconfirm before you rely on it).

## Hard constraints this repo respects

- Zero budget, no paid tier anywhere, no credit card required.
- Solana **devnet only** — never mainnet, enforced at runtime in both
  `frontend/lib/solanaConfig.ts` and `worker/src/config.ts`.
- No custom WebSocket server — Supabase Realtime does that job.
- All Solana wallet-adapter packages come from `anza-xyz` (verified current,
  not the archived `solana-labs` org) — versions pinned in each
  `package.json`, confirmed against the npm registry at build time.
