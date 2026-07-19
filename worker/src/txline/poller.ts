import { env } from "../config.js";
import { TxLineClient } from "./client.js";
import { detectBreak, MatchSnapshot, trackedMatches } from "./breakDetector.js";
import { upsertMatch } from "../db/supabaseAdmin.js";
import { onBreakStarted, onPlayResumed, resolveDueRounds } from "../game/roundManager.js";

/**
 * Starts the polling loop. This is the only long-lived process in the whole
 * stack (why it runs on Render and not Vercel — see docs/ARCHITECTURE.md).
 */
export async function startPolling(client: TxLineClient) {
  await client.ensureEntitlement();
  console.log("[poller] TxLINE entitlement active, starting poll loop");

  let tickCount = 0;

  const tick = async () => {
    tickCount += 1;
    const tickNum = tickCount;
    try {
      const fixtures = await client.fetchFixtures();

      const nowSeconds = Date.now() / 1000;

      // TxLINE returns StartTime in MILLISECONDS — divide by 1000 to
      // compare against nowSeconds (confirmed via earlier debug log).
      const candidateFixtures = (fixtures as any[]).filter((f) => {
        const startTime = Number(f.StartTime ?? 0) / 1000;
        return startTime > 0 && nowSeconds - startTime >= 0 && nowSeconds - startTime <= 3 * 60 * 60;
      });

      console.log(
        `[poller] tick ${tickNum}: fetched ${(fixtures as any[]).length} fixtures, ${candidateFixtures.length} in live window`
      );

      for (const raw of candidateFixtures) {
        const txlineMatchId = String(raw.FixtureId);

        const events = (await client.fetchScoreEvents(txlineMatchId)) as any[];

        // FIX: StatusId/Clock were previously read off the LAST raw event
        // in the /updates feed. That feed can lag behind the /snapshot
        // endpoint, and any single event object may not carry every
        // field. fetchMatchState() replays ALL records from /snapshot
        // (same merge logic already proven reliable for fetchFixtureStats)
        // to reconstruct the current true StatusId/Clock — much more
        // robust than trusting one possibly-stale event.
        const { statusId, clockSeconds: realClockSeconds } = await client.fetchMatchState(txlineMatchId);

        // FIX: TxLINE's StatusId convention is now confirmed from observed
        // data: 2 = first half (live), 3 = halftime, 4 = second half
        // (live). Previously we only treated statusId 2 as "live" and used
        // a clock-threshold (<45min = H1) to distinguish halves — that
        // broke the moment H2 started under statusId 4, since 4 !== 2 and
        // phase fell back to "NS" no matter what the clock said. Using
        // statusId directly is authoritative and removes the clock
        // threshold entirely.
        let phase = "NS";
        if (statusId === 2) phase = "H1";
        else if (statusId === 4) phase = "H2";
        // statusId 3 (halftime) intentionally falls through to "NS" —
        // breakDetector treats any non-H1/H2 phase as untracked, which is
        // what we want during the halftime gap itself.

        const snapshot: MatchSnapshot = {
          txlineMatchId,
          homeTeam: raw.Participant1IsHome ? raw.Participant1 : raw.Participant2,
          awayTeam: raw.Participant1IsHome ? raw.Participant2 : raw.Participant1,
          phase,
          // Use the REAL match clock from the reconstructed snapshot
          // state instead of a wall-time approximation — this is exact,
          // whereas nowSeconds - StartTime drifts with stoppages, VAR
          // delays, etc. Postgres column is integer, so floor it.
          clockSeconds: Math.floor(realClockSeconds),
          status: "live",
        };

        await upsertMatch(snapshot);
        console.log(
          `[poller] tick ${tickNum}: wrote match ${txlineMatchId} (${snapshot.homeTeam} vs ${snapshot.awayTeam}, phase ${phase}, statusId ${statusId}, clock ${snapshot.clockSeconds}s)`
        );

        const result = detectBreak(snapshot, events);

        // Design (updated on hackathon night, redesign #2): the round now
        // opens at BREAK START, not on resume, so fans can predict Higher/
        // Lower during the break's dead time itself. Baseline is captured
        // at break-start; resolution still waits a few minutes into real
        // play after the break ends (see roundManager.ts for the
        // resolve-window logic), which keeps the bet fair since the stat
        // is graded only once real play has actually happened.
        if (result.breakStarted) {
          console.log(`[poller] tick ${tickNum}: BREAK STARTED for ${txlineMatchId}`);
          const stats = await client.fetchFixtureStats(snapshot.txlineMatchId);
          await onBreakStarted(snapshot, result.half!, stats);
        }
        if (result.breakEnded) {
          console.log(`[poller] tick ${tickNum}: break ended (play resumed) for ${txlineMatchId}`);
          const stats = await client.fetchFixtureStats(snapshot.txlineMatchId);
          await onPlayResumed(snapshot, result.half!, stats);
        }
      }

      // Independent of any single fixture's break state: check whether
      // any already-open round has reached its resolve-window and needs
      // fresh stats pulled to grade it. Runs once per tick, not once per
      // fixture — a round only needs resolving once.
      await resolveDueRounds(client);

      const candidateIds = new Set(candidateFixtures.map((f) => String(f.FixtureId)));
      for (const id of trackedMatches.keys()) {
        if (!candidateIds.has(id)) trackedMatches.delete(id);
      }
    } catch (err) {
      console.error(`[poller] tick ${tickNum} failed:`, err);
    }
  };

  // Recursive setTimeout, not setInterval — prevents overlapping ticks if
  // one tick takes longer than POLL_INTERVAL_MS (real bug hit earlier).
  const loop = async () => {
    await tick();
    setTimeout(loop, env.POLL_INTERVAL_MS);
  };

  await loop();
}