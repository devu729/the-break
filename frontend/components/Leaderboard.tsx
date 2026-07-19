"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

interface Row {
  player_id: string;
  best_streak: number;
  total_correct: number;
  total_predictions: number;
  players: { wallet_address: string; display_name: string | null } | null;
}

function truncate(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function Leaderboard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("streaks")
      .select("player_id, best_streak, total_correct, total_predictions, players(wallet_address, display_name)")
      .order("best_streak", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setRows((data as unknown as Row[]) ?? []);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div className="card p-8 text-center text-stone-400">Loading the table…</div>;
  }

  if (rows.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="font-display text-xl">No streaks yet</p>
        <p className="mt-1 text-sm text-stone-400">Play through a break and this fills in live.</p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-pitch-900/15 text-xs uppercase tracking-widest text-stone-400">
          <tr>
            <th className="px-6 py-3">Player</th>
            <th className="px-6 py-3">Best streak</th>
            <th className="px-6 py-3">Accuracy</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const accuracy = row.total_predictions
              ? Math.round((row.total_correct / row.total_predictions) * 100)
              : 0;
            return (
              <tr key={row.player_id} className="border-b border-pitch-900/10 last:border-0">
                <td className="px-6 py-3 font-medium">
                  <span className="mr-3 text-stone-400">{i + 1}</span>
                  {row.players?.display_name ?? truncate(row.players?.wallet_address ?? "")}
                </td>
                <td className="px-6 py-3 text-amber-400">{row.best_streak}</td>
                <td className="px-6 py-3 text-stone-600">{accuracy}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
