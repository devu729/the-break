"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { Round } from "@/hooks/useSupabaseRealtime";
import type { PlayerRow } from "@/hooks/useWallet";

const STAT_LABELS: Record<string, string> = {
  total_shots: "total shots",
  corners: "corners won",
  fouls: "fouls committed",
};

export function HiLoRound({ round, player }: { round: Round; player: PlayerRow | null }) {
  const [guess, setGuess] = useState<"higher" | "lower" | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => setGuess(null), [round.id]);

  const statLabel = STAT_LABELS[round.stat_key] ?? round.stat_key.replace(/_/g, " ");
  const isResolved = round.status === "resolved";

  async function submitGuess(direction: "higher" | "lower") {
    if (!player || submitting || guess) return;
    setSubmitting(true);
    setGuess(direction);
    const { error } = await supabase
      .from("predictions")
      .insert({ round_id: round.id, player_id: player.id, guess: direction });
    if (error) setGuess(null); // let them retry (e.g. round closed mid-submit)
    setSubmitting(false);
  }

  if (isResolved) {
    return (
      <div className="card animate-reveal p-8 text-center">
        <p className="text-sm uppercase tracking-widest text-stone-400">Round resolved</p>
        <h3 className="mt-2 font-display text-3xl">
          {statLabel}: {round.baseline_value} → {round.resolved_value}
        </h3>
        <p className="mt-2 text-amber-400">
          {round.outcome === "push" ? "Push — no change" : `Went ${round.outcome}`}
        </p>
      </div>
    );
  }

  return (
    <div className="card p-8">
      <p className="text-center text-sm uppercase tracking-widest text-amber-400">Play has resumed</p>
      <p className="mt-1 text-center text-sm uppercase tracking-widest text-stone-400">
        Will {statLabel} go up in the next few minutes of live play?
      </p>
      <p className="mt-1 text-center font-display text-2xl">Baseline: {round.baseline_value}</p>

      <div className="mt-6 grid grid-cols-2 gap-4">
        <button
          onClick={() => submitGuess("higher")}
          disabled={!player || !!guess}
          className={`rounded-xl border py-4 text-lg font-semibold transition
            ${guess === "higher" ? "border-amber-400 bg-amber-500/10 text-amber-300" : "border-pitch-900/15 hover:border-amber-400/50"}
            disabled:opacity-40`}
        >
          ▲ Higher
        </button>
        <button
          onClick={() => submitGuess("lower")}
          disabled={!player || !!guess}
          className={`rounded-xl border py-4 text-lg font-semibold transition
            ${guess === "lower" ? "border-amber-400 bg-amber-500/10 text-amber-300" : "border-pitch-900/15 hover:border-amber-400/50"}
            disabled:opacity-40`}
        >
          ▼ Lower
        </button>
      </div>

      {!player && (
        <p className="mt-4 text-center text-xs text-stone-400">Connect a wallet to lock in a guess.</p>
      )}
      {guess && (
        <p className="mt-4 text-center text-xs text-amber-400/80">
          Locked in: {guess}. Resolves after a few minutes of real play.
        </p>
      )}
    </div>
  );
}
