import type { MatchSnapshot } from "../txline/breakDetector.js";
import type { TxLineClient } from "../txline/client.js";
import {
  findOpenRound,
  getDueOpenRounds,
  getMatchDbId,
  openRound,
  resolveRound,
} from "../db/supabaseAdmin.js";

/**
 * DESIGN NOTE — updated for hackathon-night redesign #2:
 *
 * Round now opens at BREAK START, not on resume. Fans predict Higher/Lower
 * DURING the dead time of the break itself (baseline = live stat at the
 * moment the break begins). It still only RESOLVES a few minutes into real
 * play after the break ends — so the guess is locked in during downtime,
 * but graded on what actually happens once the game restarts. This avoids
 * the "rigged toward lower" problem (stat can't move mid-break) while still
 * giving fans something active to do during the break, which was the whole
 * point of the product.
 */
const POST_BREAK_PREDICTION_WINDOW_MINUTES = 5;

function pickStatKey(stats: Record<string, number>): string | null {
  const keys = Object.keys(stats).filter((k) => Number.isFinite(Number(stats[k])));
  return keys.length > 0 ? keys[0] : null;
}

/**
 * Break has just started — THIS is when a round opens now, baselined on
 * live stats at the moment the break begins, so fans can predict during
 * the break itself.
 */
export async function onBreakStarted(snapshot: MatchSnapshot, half: 1 | 2, stats: Record<string, number>) {
  const matchDbId = await getMatchDbId(snapshot.txlineMatchId);
  if (!matchDbId) {
    console.warn(`[roundManager] no matches row yet for ${snapshot.txlineMatchId}, skipping round open`);
    return;
  }

  const existing = await findOpenRound(matchDbId);
  if (existing) return; // idempotency guard against a double poll

  const statKey = pickStatKey(stats);
  if (!statKey) {
    console.warn(
      `[roundManager] break started for ${snapshot.homeTeam} vs ${snapshot.awayTeam} but no usable stat found — skipping round open. Raw stats:`,
      stats
    );
    return;
  }

  const baselineValue = Number(stats[statKey]);

  const roundId = await openRound({
    matchDbId,
    half,
    statKey,
    baselineValue,
    resolvesInMinutes: POST_BREAK_PREDICTION_WINDOW_MINUTES,
  });

  console.log(
    `[roundManager] opened round ${roundId} at BREAK START for ${snapshot.homeTeam} vs ${snapshot.awayTeam} ` +
      `(half ${half}, baseline ${statKey}=${baselineValue}, resolves in ${POST_BREAK_PREDICTION_WINDOW_MINUTES}min of real play)`
  );
}

/**
 * Play has resumed after the break. The round already opened at break-start,
 * so this is now a no-op for round-opening — kept as a hook in case future
 * logic (e.g. a "play has resumed" UI event) needs it.
 */
export async function onPlayResumed(snapshot: MatchSnapshot, half: 1 | 2, stats: Record<string, number>) {
  console.log(
    `[roundManager] play resumed for ${snapshot.homeTeam} vs ${snapshot.awayTeam} — round already open from break start, nothing to do here`
  );
}

/**
 * Called once per poller tick (not per fixture) — checks every open round
 * across all matches for whether its resolve window has passed, and if
 * so, pulls fresh real stats and grades it. Decoupled from any single
 * fixture's break-detection state since a round can be due to resolve on
 * a tick where nothing else notable happened for that fixture.
 */
export async function resolveDueRounds(client: TxLineClient) {
  const due = await getDueOpenRounds();
  for (const round of due) {
    if (!round.txline_match_id) {
      console.warn(`[roundManager] round ${round.id} has no linked match, skipping resolve`);
      continue;
    }
    const stats = await client.fetchFixtureStats(round.txline_match_id);
    const resolvedValue = Number(stats[round.stat_key] ?? round.baseline_value);
    const outcome = await resolveRound(round.id, resolvedValue, round.baseline_value);

    console.log(
      `[roundManager] resolved round ${round.id} (${round.home_team} vs ${round.away_team}): ` +
        `${round.stat_key} ${round.baseline_value} -> ${resolvedValue} (${outcome})`
    );
  }
}