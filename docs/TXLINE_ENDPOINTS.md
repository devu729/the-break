# TxLINE integration notes

## Update: IDL/types are now in the repo (resolved)

`worker/src/txline/idl/txoracle.json` and `worker/src/txline/idl/txoracle.ts`
are now the real files, pulled from TxLINE's Runnable Devnet Examples page
(https://txline-docs.txodds.com/documentation/examples/devnet-examples).

**One gotcha worth flagging for TxLINE's docs team:** the JSON IDL's
top-level `"address"` field is the **mainnet** program ID
(`9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA`) even in the file meant for
devnet use. Anchor 0.30+ reads that field to decide which on-chain program
`new anchor.Program(idl, provider)` actually targets — so pasting this IDL
in as-is on a devnet project would silently point every call at the wrong
program. `client.ts`'s `ensureEntitlement()` now overrides `idl.address` to
the network's configured program ID before constructing the Program, with
a runtime assertion (`program.programId.equals(this.programId)`) as a
safety net if that ever drifts. Worth a note in TxLINE's own docs so other
devnet integrators don't hit this silently.

## Update: Fixtures and Scores endpoints now confirmed

Real endpoints, pulled from TxLINE's own API Reference:

| Purpose | Method | Path |
|---|---|---|
| Fixture metadata snapshot | GET | `/api/fixtures/snapshot` |
| Score updates (current 5-min window, live if in progress) | GET | `/api/scores/updates/{fixtureId}` |
| Latest stats snapshot | GET | `/api/scores/snapshot/{fixtureId}` |
| Live SSE stream of score updates | GET | `/api/scores/stream` |

Two real bugs found and fixed while wiring these in:
- **Soccer phase codes are `H1`/`H2`/`HT`**, not `1H`/`2H` as originally
  assumed — `breakDetector.ts`'s `phaseToHalf()` was checking the wrong
  strings entirely, which would have meant break detection silently never
  triggered even with perfect data flowing.
- **The event-type field is called `action`**, not `type` — same kind of
  silent-failure risk, now fixed in `breakDetector.ts` and `poller.ts`.

**Still genuinely unresolved, even with these endpoints confirmed:**
- **The exact set of possible `action` values isn't enumerated anywhere in
  TxLINE's docs.** `STOPPAGE_EVENT_TYPES` in `breakDetector.ts` is still an
  educated guess (`foul`, `corner`, `throw_in`, etc.) — verify against real
  data from an actual live fixture before trusting break detection fully.
- **No documented soccer match-minute field.** TxLINE's Scores schema only
  documents an explicit `clock` object for US Football. `poller.ts`
  approximates elapsed match time as wall-clock time since kickoff
  (`nowSeconds - StartTime`), which won't account for stoppage time —
  good enough for the ~20-minute threshold check, not exact.
- **`stats` key scheme is numeric, not named.** The Scores response
  includes a `stats` map, but nothing in what we've seen from TxLINE's docs
  maps a numeric `StatKey` to a human name like "total shots." Their
  Merkle-proof endpoints (`/api/scores/stat-validation`) mention "e.g., 1
  for 'Participant1_Score'" as one example, suggesting a key reference
  exists somewhere, but we haven't found it. `DEFAULT_STAT_KEY` in
  `roundManager.ts` should be treated as unverified until you can inspect
  a real `stats` payload during a live match and confirm which key
  actually represents shots (or pick a different, confirmed stat instead).
- **The live SSE stream (`/api/scores/stream`) is confirmed to exist and
  is almost certainly the "correct" way to do this** (push-based, no
  polling latency) — the worker still uses interval polling via
  `/api/scores/updates/{fixtureId}` instead. Swapping to the SSE stream is
  the highest-value follow-up if there's time before the demo.

## Confirmed against the official "World Cup Free Tier" page

Source: https://txline-docs.txodds.com/documentation/worldcup (full text supplied
by the project owner and cross-checked here — this supersedes the guesses
below where they overlap).

- **Devnet free tier is service level `1` only.** Its current pricing-matrix
  row reports `samplingIntervalSec = 0` — i.e. devnet's free tier is
  effectively real-time, not delayed. (Mainnet has two free levels: `1` for
  60-second-delayed data, `12` for real-time — not relevant here since this
  project is devnet-only.)
- **`DURATION_WEEKS = 4`, `SELECTED_LEAGUES = []`** for the standard free
  bundle — matches what's in `client.ts` and `.env.example`.
- **The message signed for activation is exactly**
  `${txSig}:${leagues.join(",")}:${jwt}`, which for the empty-leagues case
  is `${txSig}::${jwt}` — matches `client.ts`.
- **Program ID / token mint / API host for devnet** all match what's already
  in `worker/.env.example` — no changes needed there.
- **You need a matching TypeScript type file, not just the IDL.** The
  official example imports `import type { Txoracle } from "./types/txoracle"`
  alongside `txoracle.json`. `worker/src/txline/idl/README.md` only asked
  for the JSON — grab the matching `types/txoracle.ts` (or `.d.ts`) from the
  same Runnable Devnet Examples page and drop it in
  `worker/src/txline/idl/` too, then update the import in `client.ts` to use
  `anchor.Program<Txoracle>` instead of the untyped `anchor.Idl` cast.
- **The real API is organized around Fixtures / Odds / Scores / Validation
  Proofs**, not the generic "matches" naming this repo's `client.ts` used
  as a placeholder. Renamed below to match TxLINE's actual vocabulary
  (`fetchFixtures`, `fetchScoreEvents`) — exact paths are still unconfirmed,
  see below.
- **Likely uses a live stream (SSE), not just polling.** The free tier page
  and quickstart both mention "connect to streams" and an "SSE client
  dependency," and the Odds/Scores API Reference entries explicitly say
  "stream StablePrice odds" / "stream score events." This project's worker
  currently polls on a plain interval (`POLL_INTERVAL_MS`), which will
  still work but throws away the point of a push-based stream (added
  latency = you might miss the exact stoppage event that starts a break).
  **If you want this fixed for real,** the right move is to replace
  `worker/src/txline/poller.ts`'s `setInterval` loop with an SSE
  connection to whatever the docs' Scores stream endpoint turns out to be,
  and feed events into `breakDetector.ts` as they arrive instead of on a
  timer. Flagging this rather than guessing at a stream URL and shipping
  something that looks right but silently isn't.

## Endpoints confirmed against current docs (as of build time)

Source: https://txline-docs.txodds.com/documentation/quickstart

| Purpose | Method | URL |
|---|---|---|
| Guest JWT (devnet) | POST | `https://txline-dev.txodds.com/auth/guest/start` |
| Guest JWT (mainnet — not used in this project) | POST | `https://txline.txodds.com/auth/guest/start` |
| Purchase quote (paid tiers only, not used here) | POST | `{apiOrigin}/api/guest/purchase/quote` |
| Activate API token | POST | `{apiOrigin}/api/token/activate` |

Devnet network config:

| Field | Value |
|---|---|
| Program ID | `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` |
| TxL token mint | `4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG` |
| Solana RPC | `https://api.devnet.solana.com` |
| API origin | `https://txline-dev.txodds.com` |

Auth flow (implemented in `worker/src/txline/client.ts`):

1. Derive `token_treasury_v2` PDA, its associated token vault, and the
   `pricing_matrix` PDA.
2. Call the on-chain `subscribe(serviceLevelId, durationWeeks)` instruction
   with the World Cup free-tier service level (docs say "service levels 1
   or 12" for the free path — **confirm which one is World Cup vs.
   International Friendlies before a real demo**, we defaulted to `1`).
3. Get a guest JWT.
4. Sign `${txSig}:${leagues.join(",")}:${jwt}` with the wallet's secret key
   (detached nacl signature, base64-encoded).
5. POST to `/api/token/activate` with `txSig`, `walletSignature`, `leagues`.
6. Use the returned `apiToken` as `X-Api-Token` alongside `Authorization:
   Bearer {jwt}` on every data call.

## Friction points / honest feedback (as requested by the hackathon)

- **The quickstart doesn't show the live-data endpoint shapes.** It's very
  thorough on auth + on-chain entitlement, but stops right at "you're now
  ready to use the API" without a worked example of a live-scores or
  match-events call. We had to write `fetchLiveMatches` /
  `fetchMatchEvents` / `fetchMatchStats` in `worker/src/txline/client.ts`
  against a best-guess REST shape (`GET {apiOrigin}/api/matches/...` with
  the same two auth headers used for activation). **These paths need to be
  confirmed against the full API Reference
  (https://txline-docs.txodds.com/api-reference) before this is
  demo-safe** — treat every call in `client.ts` marked `PATH UNCONFIRMED`
  as a placeholder, not a verified integration.
- **The Anchor IDL isn't inline in the docs.** The `subscribe()` call needs
  the program's IDL/types, which the quickstart references as living in a
  separate "Runnable Devnet Examples" page rather than being pasted or
  linked directly from the quickstart itself. That's an extra hop for
  anyone trying to go from zero to a working `subscribe()` call.
- **Wallet-for-a-free-tier is an unusual ask**, and worth flagging even
  though it's well-justified here (on-chain entitlement tracking is the
  product's whole pitch). Teams evaluating TxLINE quickly for a free-data
  use case may bounce off "why do I need a wallet for free data" before
  reading far enough to see the reasoning. A one-line "why" callout right
  at the top of the free-tier page would help.
- **60-second-delayed vs. real-time free tiers** exist per TxLINE's FAQ,
  but the quickstart's `subscribe()` example doesn't show which
  `serviceLevelId` maps to which latency tier — we inferred `1` as the
  default free/standard bundle from the "Standard Subscription" tab, but
  this should be double-checked against the World Cup Free Tier guide
  specifically (`/documentation/worldcup`) rather than assumed from the
  general quickstart.

## What this project does NOT rely on

- No mainnet transactions, ever (`SOLANA_NETWORK` is hard-enforced to
  `devnet` in `worker/src/config.ts` and `frontend/lib/solanaConfig.ts`).
- No TxL token purchases — the World Cup data path is free, and this repo
  never calls the `/api/guest/purchase/quote` flow.
