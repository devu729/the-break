import { createClient } from "@supabase/supabase-js";
import { env } from "../config.js";
import type { MatchSnapshot } from "../txline/breakDetector.js";

// Service-role client — full write access, bypasses RLS. Never ship this
// key to the frontend; it lives only in the worker's environment.
export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

export async function upsertMatch(snapshot: MatchSnapshot): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("matches")
    .upsert(
      {
        txline_match_id: snapshot.txlineMatchId,
        home_team: snapshot.homeTeam,
        away_team: snapshot.awayTeam,
        status: snapshot.status,
        phase: snapshot.phase,
        match_clock_seconds: snapshot.clockSeconds,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "txline_match_id" }
    )
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}

export async function getMatchDbId(txlineMatchId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("matches")
    .select("id")
    .eq("txline_match_id", txlineMatchId)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

export async function openRound(params: {
  matchDbId: string;
  half: 1 | 2;
  statKey: string;
  baselineValue: number;
  resolvesInMinutes: number;
}): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("rounds")
    .insert({
      match_id: params.matchDbId,
      half: params.half,
      status: "open",
      stat_key: params.statKey,
      baseline_value: params.baselineValue,
      resolves_at: new Date(Date.now() + params.resolvesInMinutes * 60 * 1000).toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function findOpenRound(matchDbId: string) {
  const { data, error } = await supabaseAdmin
    .from("rounds")
    .select("*")
    .eq("match_id", matchDbId)
    .eq("status", "open")
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Open rounds whose resolve window (resolves_at) has already passed —
 * these are ready to be graded on the next poller tick, regardless of
 * which fixture originally triggered them. Joins matches to get the
 * txline_match_id needed to fetch fresh stats.
 */
export async function getDueOpenRounds(): Promise<
  Array<{
    id: string;
    stat_key: string;
    baseline_value: number;
    txline_match_id: string;
    home_team: string;
    away_team: string;
  }>
> {
  const { data, error } = await supabaseAdmin
    .from("rounds")
    .select("id, stat_key, baseline_value, matches(txline_match_id, home_team, away_team)")
    .eq("status", "open")
    .lte("resolves_at", new Date().toISOString());
  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: row.id,
    stat_key: row.stat_key,
    baseline_value: row.baseline_value,
    txline_match_id: row.matches?.txline_match_id,
    home_team: row.matches?.home_team,
    away_team: row.matches?.away_team,
  }));
}

export async function resolveRound(roundId: string, resolvedValue: number, baselineValue: number) {
  const outcome = resolvedValue > baselineValue ? "higher" : resolvedValue < baselineValue ? "lower" : "push";

  const { error } = await supabaseAdmin
    .from("rounds")
    .update({
      status: "resolved",
      resolved_value: resolvedValue,
      outcome,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", roundId);
  if (error) throw error;

  // Grade every prediction for this round.
  const { data: preds, error: predErr } = await supabaseAdmin
    .from("predictions")
    .select("id, player_id, guess")
    .eq("round_id", roundId);
  if (predErr) throw predErr;

  for (const pred of preds ?? []) {
    const correct = outcome !== "push" && pred.guess === outcome;
    await supabaseAdmin.from("predictions").update({ correct }).eq("id", pred.id);
    await applyStreakUpdate(pred.player_id, correct);
  }

  return outcome;
}

async function applyStreakUpdate(playerId: string, correct: boolean) {
  const { data: existing, error } = await supabaseAdmin
    .from("streaks")
    .select("*")
    .eq("player_id", playerId)
    .maybeSingle();
  if (error) throw error;

  const current = existing?.current_streak ?? 0;
  const best = existing?.best_streak ?? 0;
  const totalCorrect = existing?.total_correct ?? 0;
  const totalPredictions = existing?.total_predictions ?? 0;

  const nextCurrent = correct ? current + 1 : 0;
  const nextBest = Math.max(best, nextCurrent);

  const { error: upsertErr } = await supabaseAdmin.from("streaks").upsert({
    player_id: playerId,
    current_streak: nextCurrent,
    best_streak: nextBest,
    total_correct: totalCorrect + (correct ? 1 : 0),
    total_predictions: totalPredictions + 1,
    updated_at: new Date().toISOString(),
  });
  if (upsertErr) throw upsertErr;
}
