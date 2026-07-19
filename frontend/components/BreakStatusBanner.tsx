"use client";

import type { Round } from "@/hooks/useSupabaseRealtime";

interface MatchInfo {
  status: string;
  phase: string | null;
  match_clock_seconds: number | null;
  home_team: string;
  away_team: string;
}

export function BreakStatusBanner({ match, currentRound }: { match: MatchInfo | null; currentRound: Round | null }) {
  if (!match) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm uppercase tracking-widest text-amber-500/80">Waiting for kickoff</p>
        <h2 className="mt-2 font-display text-2xl">This match hasn't started yet</h2>
        <p className="mt-1 text-sm text-stone-400">The break window opens once the worker sees live data.</p>
      </div>
    );
  }

  if (currentRound?.status === "open") {
    return (
      <div className="card relative overflow-hidden p-8 text-center">
        <div className="absolute inset-x-0 top-0 h-1 origin-left bg-amber-500 animate-pulse-fill" />
        <p className="text-sm uppercase tracking-widest text-amber-400">Play has resumed — half {currentRound.half}</p>
        <h2 className="mt-2 font-display text-2xl">Predict the next few minutes</h2>
        <p className="mt-1 text-sm text-stone-400">Everyone watching this match is predicting the same window, right now.</p>
      </div>
    );
  }

  const minutesElapsed = match.match_clock_seconds ? Math.floor(match.match_clock_seconds / 60) : 0;
  const threshold = 20;
  const minutesUntil = Math.max(0, threshold - minutesElapsed);

  return (
    <div className="card p-8 text-center">
      <p className="text-sm uppercase tracking-widest text-stone-400">
        {match.home_team} {match.status === "live" ? "vs" : "—"} {match.away_team}
      </p>
      <h2 className="mt-2 font-display text-2xl">
        {minutesUntil > 0 ? `No break yet — roughly ${minutesUntil} min until the window opens` : "Break window open — watching for the next stoppage"}
      </h2>
      <p className="mt-1 text-sm text-stone-400">
        The break isn't on a fixed clock — it starts at the referee's next natural stoppage.
      </p>
    </div>
  );
}
