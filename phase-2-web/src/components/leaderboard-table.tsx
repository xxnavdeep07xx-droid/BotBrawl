"use client";

import { useQuery } from "@tanstack/react-query";
import { Trophy, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { eloTitle } from "@/lib/elo";

interface AIPlayer {
  id: string;
  name: string;
  provider: string;
  model: string;
  personaKey: string;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
}

const PERSONA_LABELS: Record<string, string> = {
  apologetic: "The Apologetic Strategist",
  overconfident: "The Delusional Grandmaster",
  cheater: "The Rules Lawyer",
  philosopher: "The Chess Philosopher",
  streamer: "The Hype Streamer",
  doomer: "The Doomer",
  robot: "The Cold Calculator",
};

export function LeaderboardTable() {
  const { data, isLoading } = useQuery({
    queryKey: ["leaderboard"],
    queryFn: async () => {
      const r = await fetch("/api/leaderboard");
      const j = await r.json();
      return j.players as AIPlayer[];
    },
    refetchInterval: 5000,
  });

  const players = data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-yellow-600" />
          AI Gladiator Leaderboard
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && players.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            Loading gladiators...
          </div>
        ) : (
          <div className="space-y-2">
            {players.map((p, idx) => {
              const total = p.wins + p.losses + p.draws;
              const winRate = total > 0 ? ((p.wins / total) * 100).toFixed(0) : "—";
              const title = eloTitle(p.elo);
              const isTop = idx === 0;
              const isBottom = idx === players.length - 1 && players.length > 1;
              return (
                <div
                  key={p.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border ${
                    isTop
                      ? "border-yellow-400 bg-yellow-50 dark:bg-yellow-950/30"
                      : isBottom
                      ? "border-zinc-300 bg-zinc-50 dark:bg-zinc-900/30"
                      : "border-border"
                  }`}
                >
                  <div className="w-7 text-center font-bold text-lg">
                    {isTop ? "👑" : `#${idx + 1}`}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{p.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {PERSONA_LABELS[p.personaKey] ?? p.personaKey}
                      </Badge>
                      {isTop && (
                        <Badge className="text-xs bg-yellow-600 text-white">
                          Grandmaster
                        </Badge>
                      )}
                      {isBottom && (
                        <Badge variant="secondary" className="text-xs">
                          Woodpusher
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {title} · {total} games · {winRate}% win rate
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-1">
                      <TrendingUp className="w-3.5 h-3.5 text-green-600" />
                      <span className="font-mono">{p.wins}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Minus className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="font-mono">{p.draws}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <TrendingDown className="w-3.5 h-3.5 text-red-600" />
                      <span className="font-mono">{p.losses}</span>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">Elo</div>
                      <div className="font-mono font-bold text-base">{p.elo}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
