# Architecture

```
┌─────────────────────────────┐
│   FRONTEND (Vercel, free)   │
│   Next.js 14+ App Router    │
│   Wallet Adapter (devnet)   │
│   Subscribes to Supabase    │
│   Realtime channel          │
└──────────────┬───────────────┘
               │ reads/writes via Supabase client SDK
┌──────────────▼───────────────┐
│   SUPABASE (free tier)       │
│   - Postgres (players,       │
│     streaks, rounds, matches)│
│   - Realtime (Postgres       │
│     change subscriptions —   │
│     this replaces a custom   │
│     WebSocket server)        │
└──────────────▲───────────────┘
               │ writes rows when a break/round is detected
┌──────────────┴───────────────┐
│  WORKER (Render free tier,   │
│  no card required)           │
│  Always-on Node process:     │
│  - Polls TxLINE API          │
│  - Detects real hydration    │
│    break from live events    │
│  - Writes round-start /      │
│    round-resolve rows to     │
│    Supabase                  │
└───────────────────────────────┘
```

## Why this shape

Vercel serverless functions are stateless and short-lived by design — they
can't hold a persistent connection or run a long-lived polling loop, so a
custom WebSocket server has no home there. The worker is the one piece of
this whole system that genuinely needs to run continuously: it has to keep
polling TxLINE and watching the live event feed for the exact moment a
stoppage happens after the threshold minute, because that moment isn't on a
fixed clock.

Rather than have that worker also host a WebSocket server (a second
always-on service, more surface area, more to deploy for free), it writes
straight to Postgres. Supabase Realtime listens to the Postgres write-ahead
log and pushes row changes to every subscribed client over a connection
Supabase already manages. So:

- The worker's job shrinks to "detect the break, write a row." No socket
  code, no client connection management, no reconnect logic.
- The frontend's job shrinks to "subscribe to one table, render what comes
  in." No custom protocol, no message shapes to design.
- Vercel only ever serves static/serverless Next.js output, which is exactly
  the shape of workload its free tier is built for.

The tradeoff: Supabase Realtime adds a small amount of propagation latency
versus a hand-rolled socket server broadcasting directly, and you're
depending on Supabase's free-tier connection limits holding up under
concurrent viewers. For a hackathon-scale audience watching a handful of
matches, that's a good trade for the amount of infrastructure it removes.

## Data flow for one break

1. Worker polls TxLINE on an interval (`POLL_INTERVAL_MS`), pulling live
   match snapshots and each match's event timeline.
2. `breakDetector.ts` tracks match clock + stoppage events per match. Once
   the clock passes the threshold minute in a half, the *next* stoppage-type
   event (foul, throw-in, corner, etc.) is treated as the real break start —
   not a fixed timestamp.
3. `roundManager.ts` opens a `rounds` row with the current stat baseline
   (e.g. total shots) the moment a break starts.
4. That INSERT lands in every subscribed browser via Supabase Realtime,
   which flips the UI from "break incoming" to "round live."
5. When the break ends (play resumes, or a fixed safety-net window elapses),
   the worker re-reads the stat and writes the resolution back to the same
   row, which grades every prediction and updates streaks in the same pass.
