"use client";

import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";

function truncate(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/**
 * Deliberately not using WalletMultiButton's default styling — it reads as
 * a plugged-in crypto widget. This wraps the same wallet-adapter hooks
 * behind the app's own button treatment (see .btn-primary / .btn-ghost in
 * globals.css) so connect/disconnect feels native to the product.
 */
export function WalletConnectButton() {
  const { setVisible } = useWalletModal();
  const { publicKey, disconnect, connecting } = useWallet();

  if (publicKey) {
    return (
      <button onClick={() => disconnect()} className="btn-ghost gap-2">
        <span className="h-2 w-2 rounded-full bg-amber-400" />
        {truncate(publicKey.toBase58())}
      </button>
    );
  }

  return (
    <button onClick={() => setVisible(true)} className="btn-primary" disabled={connecting}>
      {connecting ? "Connecting…" : "Connect wallet"}
    </button>
  );
}
