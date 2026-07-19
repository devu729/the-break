# Known limitations

## Design note: the prediction window was redesigned mid-hackathon

The original design had players predict whether a stat would change
*during* the hydration break itself. That's a structurally weak bet —
play is stopped during a break, so the stat almost never actually moves,
making the prediction close to rigged toward "no change" every time.

Fixed: the round now opens the moment play **resumes** after the break
(baseline captured live, right as the whistle goes) and resolves a few
minutes into real, live play. This is a genuinely uncertain prediction —
tied to the break as the trigger moment, but not asking players to bet on
frozen data.

Being upfront about what this build does and doesn't handle:

- **TxLINE data-endpoint paths are unconfirmed.** The auth/activation flow
  is implemented against TxLINE's documented quickstart, but the actual
  live-match-data read calls (`fetchLiveMatches`, `fetchMatchEvents`,
  `fetchMatchStats`) use a best-guess REST shape. See
  `docs/TXLINE_ENDPOINTS.md` for the exact gap. Until these are confirmed
  against TxLINE's full API Reference, the worker won't successfully pull
  real match data end-to-end.
- **Break detection depends on feed latency.** The detector reacts to the
  next stoppage-type event after the threshold minute — if TxLINE's event
  feed lags or an event's `type` field doesn't match our
  `STOPPAGE_EVENT_TYPES` set, a break can be missed or flagged late. The
  3-minute-plus-margin fallback timer (`maxBreakSeconds` in
  `breakDetector.ts`) exists specifically to recover from a missed
  "play resumed" event, but it's a safety net, not a substitute for
  accurate event typing.
- **Anti-cheat is effectively none.** Predictions are graded entirely by
  the worker using the service-role key, which is correct — but there's no
  protection against a player opening two wallets and hedging both
  directions on the same round, or reading the resolved stat from a public
  Supabase read before the round officially flips to `resolved` (a client
  fast enough to poll could theoretically see `resolved_value` land before
  `status` does, depending on write ordering). Production fix: resolve
  rounds via a single atomic RPC/transaction on the Supabase side instead
  of the two-step update-then-grade the worker does now, and rate-limit or
  wallet-gate multi-account play.
- **The IDL isn't vendored** (see `worker/src/txline/idl/README.md`) — the
  worker will not run until someone drops in the current TxLINE Anchor IDL.
  This is deliberate (a stale IDL is worse than an obvious missing-file
  error) but it does mean the repo isn't runnable out of the box.
- **Leaderboard is global only.** No per-match or per-tournament-stage
  leaderboards yet — `streaks` aggregates across every match a player has
  ever predicted in.
- **Single worker instance assumed.** `breakDetector.ts` keeps per-match
  state in an in-memory `Map`. Fine for one Render dyno; if the worker is
  ever scaled horizontally, that state needs to move into Postgres or a
  shared store, or two workers can race to open the same round (the
  `findOpenRound` idempotency check in `roundManager.ts` only closes half
  that gap).
- **No reconnect/backoff tuning on the TxLINE HTTP calls** beyond a single
  401-then-retry cycle in `client.ts`. A sustained TxLINE outage will show
  up as repeated `[poller] tick failed` log lines rather than a graceful
  degraded state in the UI.
- **Devnet SOL faucet rate limits** aren't handled — if the worker wallet
  needs re-funding mid-demo (e.g. re-subscribing after the free tier's
  duration window lapses), that's a manual step, not automated.
