"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useMatchRounds } from "@/hooks/useSupabaseRealtime";
import { usePlayer } from "@/hooks/useWallet";
import { BreakStatusBanner } from "@/components/BreakStatusBanner";
import { HiLoRound } from "@/components/HiLoRound";
import { StreakBadge } from "@/components/StreakBadge";
import { WalletConnectButton } from "@/components/WalletConnectButton";

interface MatchInfo {
  id: string;
  home_team: string;
  away_team: string;
  status: string;
  phase: string | null;
  match_clock_seconds: number | null;
}

export default function MatchPage() {
  const params = useParams<{ id: string }>();
  const matchId = params.id;
  const [match, setMatch] = useState<MatchInfo | null>(null);
  const { currentRound, rounds } = useMatchRounds(matchId ?? null);
  const { player } = usePlayer();

  useEffect(() => {
    if (!matchId) return;
    const load = () =>
      supabase
        .from("matches")
        .select("id, home_team, away_team, status, phase, match_clock_seconds")
        .eq("id", matchId)
        .maybeSingle()
        .then(({ data }) => setMatch(data));

    load();
    const channel = supabase
      .channel(`match:${matchId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "matches", filter: `id=eq.${matchId}` },
        () => load()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [matchId]);

  return (
    <div className="space-y-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl">
          {match ? `${match.home_team} vs ${match.away_team}` : "Loading match…"}
        </h1>
        <div className="flex items-center gap-3">
          <StreakBadge playerId={player?.id ?? null} />
          <WalletConnectButton />
        </div>
      </div>

      <BreakStatusBanner match={match} currentRound={currentRound} />

      {currentRound && <HiLoRound round={currentRound} player={player} />}

      {rounds.length > 1 && (
        <div>
          <h2 className="mb-3 font-display text-lg text-stone-600">Past rounds this match</h2>
          <div className="space-y-2">
            {rounds
              .filter((r) => r.status === "resolved")
              .map((r) => (
                <div key={r.id} className="card flex items-center justify-between px-5 py-3 text-sm">
                  <span className="text-stone-400">Half {r.half} · {r.stat_key.replace(/_/g, " ")}</span>
                  <span>
                    {r.baseline_value} → {r.resolved_value}{" "}
                    <span className="text-amber-400">({r.outcome})</span>
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
