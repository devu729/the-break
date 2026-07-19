"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export function StreakBadge({ playerId }: { playerId: string | null }) {
  const [streak, setStreak] = useState<{ current_streak: number; best_streak: number } | null>(null);

  useEffect(() => {
    if (!playerId) return;
    supabase
      .from("streaks")
      .select("current_streak, best_streak")
      .eq("player_id", playerId)
      .maybeSingle()
      .then(({ data }) => setStreak(data));
  }, [playerId]);

  if (!playerId) return null;

  return (
    <div className="flex items-center gap-2 rounded-full border border-pitch-900/15 bg-white/5 px-4 py-1.5 text-sm">
      <span className="text-amber-400">🔥</span>
      <span className="font-semibold">{streak?.current_streak ?? 0}</span>
      <span className="text-stone-400">streak</span>
      {streak && streak.best_streak > streak.current_streak && (
        <span className="text-stone-400">· best {streak.best_streak}</span>
      )}
    </div>
  );
}
