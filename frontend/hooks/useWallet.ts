"use client";

import { useEffect, useState } from "react";
import { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import { supabase } from "@/lib/supabaseClient";

export interface PlayerRow {
  id: string;
  wallet_address: string;
  display_name: string | null;
}

/**
 * Wraps the Solana wallet-adapter's useWallet with a Supabase `players`
 * lookup/upsert, so the rest of the app can just ask "who's the current
 * player" instead of juggling a raw pubkey everywhere.
 */
export function usePlayer() {
  const { publicKey, connected } = useSolanaWallet();
  const [player, setPlayer] = useState<PlayerRow | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!connected || !publicKey) {
      setPlayer(null);
      return;
    }

    const walletAddress = publicKey.toBase58();
    setLoading(true);

    (async () => {
      const { data: existing } = await supabase
        .from("players")
        .select("*")
        .eq("wallet_address", walletAddress)
        .maybeSingle();

      if (existing) {
        setPlayer(existing as PlayerRow);
        await supabase
          .from("players")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("id", existing.id);
      } else {
        const { data: created, error } = await supabase
          .from("players")
          .insert({ wallet_address: walletAddress })
          .select("*")
          .single();
        if (!error) setPlayer(created as PlayerRow);
      }
      setLoading(false);
    })();
  }, [connected, publicKey]);

  return { player, loading, connected };
}
