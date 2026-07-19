"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { WalletConnectButton } from "@/components/WalletConnectButton";

interface MatchRow {
  id: string;
  home_team: string;
  away_team: string;
  status: string;
  kickoff_utc: string | null;
}

export default function HomePage() {
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("matches")
      .select("id, home_team, away_team, status, kickoff_utc")
      .order("updated_at", { ascending: false })
      .limit(20)
      .then(({ data }) => {
        setMatches(data ?? []);
        setLoading(false);
      });
  }, []);

  return (
    <div>
      <section className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-sm uppercase tracking-[0.2em] text-amber-500">World Cup 2026</p>
        <h1 className="max-w-xl font-display text-5xl font-semibold leading-tight">
          Every hydration break is a round.
        </h1>
        <p className="max-w-md text-stone-400">
          The referee decides when the break starts, not a clock. Connect a wallet, pick a match,
          and guess higher or lower the second the whistle goes.
        </p>
        <div className="mt-2">
          <WalletConnectButton />
        </div>
      </section>

      <section className="pb-8">
        <h2 className="mb-4 font-display text-xl">Matches</h2>
        {loading && <div className="card p-8 text-center text-stone-400">Finding live matches…</div>}
        {!loading && matches.length === 0 && (
          <div className="card p-8 text-center">
            <p className="font-display text-xl">Nothing live right now</p>
            <p className="mt-1 text-sm text-stone-400">
              The worker populates this the moment it sees a match on TxLINE's feed.
            </p>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {matches.map((m) => (
            <Link
              key={m.id}
              href={`/match/${m.id}`}
              className="card flex items-center justify-between p-5 transition hover:border-amber-400/40"
            >
              <div>
                <p className="font-display text-lg">
                  {m.home_team} vs {m.away_team}
                </p>
                <p className="text-xs uppercase tracking-widest text-stone-400">{m.status}</p>
              </div>
              <span className="text-amber-400">→</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
