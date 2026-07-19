"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export interface Round {
  id: string;
  match_id: string;
  half: 1 | 2;
  status: "open" | "resolved" | "voided";
  stat_key: string;
  baseline_value: number;
  resolved_value: number | null;
  outcome: "higher" | "lower" | "push" | null;
  opened_at: string;
  resolves_at: string | null;
  resolved_at: string | null;
}

/**
 * Subscribes to the `rounds` table for a single match via Supabase
 * Realtime (Postgres change feed) — this is the piece that replaces a
 * custom WebSocket server. Every INSERT/UPDATE on `rounds` for this match
 * pushes straight into React state.
 */
export function useMatchRounds(matchDbId: string | null) {
  const [rounds, setRounds] = useState<Round[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!matchDbId) return;
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("rounds")
        .select("*")
        .eq("match_id", matchDbId)
        .order("opened_at", { ascending: false });
      if (!cancelled) {
        if (!error && data) setRounds(data as Round[]);
        setLoading(false);
      }
    })();

    const channel = supabase
      .channel(`rounds:match:${matchDbId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rounds", filter: `match_id=eq.${matchDbId}` },
        (payload) => {
          setRounds((prev) => {
            const incoming = payload.new as Round;
            if (payload.eventType === "DELETE") {
              return prev.filter((r) => r.id !== (payload.old as Round).id);
            }
            const idx = prev.findIndex((r) => r.id === incoming.id);
            if (idx === -1) return [incoming, ...prev];
            const next = [...prev];
            next[idx] = incoming;
            return next;
          });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [matchDbId]);

  const currentRound = rounds.find((r) => r.status === "open") ?? rounds[0] ?? null;
  return { rounds, currentRound, loading };
}
