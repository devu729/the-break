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
      const candidateFixtures = (fixtures as any[]).filter((f) => {
        const startTime = Number(f.StartTime ?? 0);
        return startTime > 0 && nowSeconds - startTime >= 0 && nowSeconds - startTime <= 3 * 60 * 60;
      });

      console.log(
        `[poller] tick ${tickNum}: fetched ${(fixtures as any[]).length} fixtures, ${candidateFixtures.length} in live window`
      );

      for (const raw of candidateFixtures) {
        const txlineMatchId = String(raw.FixtureId);

        const events = (await client.fetchScoreEvents(txlineMatchId)) as any[];
        const latestEvent = events[events.length - 1];
        const phase = String(latestEvent?.statusSoccerId ?? "NS");

        const snapshot: MatchSnapshot = {
          txlineMatchId,
          homeTeam: raw.Participant1IsHome ? raw.Participant1 : raw.Participant2,
          awayTeam: raw.Participant1IsHome ? raw.Participant2 : raw.Participant1,
          phase,
          clockSeconds: Math.min(nowSeconds - Number(raw.StartTime ?? nowSeconds), 90 * 60),
          status: "live",
        };

        await upsertMatch(snapshot);
        console.log(
          `[poller] tick ${tickNum}: wrote match ${txlineMatchId} (${snapshot.homeTeam} vs ${snapshot.awayTeam}, phase ${phase})`
        );

        const result = detectBreak(snapshot, events);

        // Design (locked in after several iterations): predicting on a
        // stat DURING the break is a broken bet — play is stopped, so
        // "will it change" almost always resolves to "no." Instead:
        //   - breakStarted: just log it, don't open a round yet.
        //   - breakEnded (= play has just resumed): THIS is when we open
        //     the round, baselined on real live play, resolving a few
        //     minutes later once real play has actually happened. See
        //     roundManager.ts for the resolve-window logic.
        if (result.breakStarted) {
          console.log(`[poller] tick ${tickNum}: BREAK STARTED for ${txlineMatchId}`);
          await onBreakStarted(snapshot, result.half!);
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
