import { Leaderboard } from "@/components/Leaderboard";

export default function LeaderboardPage() {
  return (
    <div className="space-y-6 py-8">
      <div>
        <h1 className="font-display text-3xl">Leaderboard</h1>
        <p className="mt-1 text-stone-400">Ranked by best streak, across every match.</p>
      </div>
      <Leaderboard />
    </div>
  );
}
