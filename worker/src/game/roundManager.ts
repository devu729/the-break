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
 * DESIGN NOTE — this is the core fix from the hackathon-night redesign:
 *
 * Originally, a round opened at the START of the break and resolved at
 * the END of it — i.e. predicting whether a stat would change WHILE PLAY
 * WAS STOPPED. That's a broken bet: since play is paused, the stat
 * almost never moves, so the round was structurally rigged toward
 * "lower" every single time. Real, fair critique, fixed here.
 *
 * New design: the round opens the moment play RESUMES after the break
 * (baseline = live stat right as the whistle goes), and resolves
 * POST_BREAK_PREDICTION_WINDOW_MINUTES later, once real live play has
 * actually happened. That's a genuinely uncertain bet — will a shot,
 * corner, etc. happen in the next few minutes of real play — not a
 * coin flip rigged by dead time.
 */
const POST_BREAK_PREDICTION_WINDOW_MINUTES = 5;

function pickStatKey(stats: Record<string, number>): string | null {
  const keys = Object.keys(stats).filter((k) => Number.isFinite(Number(stats[k])));
  return keys.length > 0 ? keys[0] : null;
}

/** Break has just started — nothing to open yet, just log it for visibility. */
export async function onBreakStarted(snapshot: MatchSnapshot, half: 1 | 2) {
  console.log(
    `[roundManager] break started for ${snapshot.homeTeam} vs ${snapshot.awayTeam} (half ${half}) — ` +
      `round will open once play resumes, not now`
  );
}

/**
 * Play has just resumed after the break — THIS is when a round opens,
 * baselined on real live stats at the moment of resumption.
 */
export async function onPlayResumed(snapshot: MatchSnapshot, half: 1 | 2, stats: Record<string, number>) {
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
      `[roundManager] play resumed for ${snapshot.homeTeam} vs ${snapshot.awayTeam} but no usable stat found — skipping round open. Raw stats:`,
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
    `[roundManager] opened round ${roundId} for ${snapshot.homeTeam} vs ${snapshot.awayTeam} ` +
      `(half ${half}, baseline ${statKey}=${baselineValue}, resolves in ${POST_BREAK_PREDICTION_WINDOW_MINUTES}min of real play)`
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
