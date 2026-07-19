import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import "../styles/globals.css";
import { WalletContextProvider } from "@/components/WalletContextProvider";
import Link from "next/link";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
});
const body = Inter({ subsets: ["latin"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "The Break — hydration-break predictions",
  description: "Every World Cup hydration break, one synchronized Hi-Lo round.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <WalletContextProvider>
          <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-6">
            <header className="flex items-center justify-between py-6">
              <Link href="/" className="font-display text-xl font-semibold tracking-tight">
                The Break
              </Link>
              <nav className="flex items-center gap-6 text-sm text-stone-600">
                <Link href="/leaderboard" className="hover:text-amber-400">
                  Leaderboard
                </Link>
              </nav>
            </header>
            <main className="flex-1 pb-16">{children}</main>
            <footer className="border-t border-pitch-900/10 py-6 text-xs text-stone-400">
              Solana devnet · not real money · World Cup data via TxLINE
            </footer>
          </div>
        </WalletContextProvider>
      </body>
    </html>
  );
}
