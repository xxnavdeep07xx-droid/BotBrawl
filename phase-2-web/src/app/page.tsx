"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Coins, RefreshCw } from "lucide-react";
import { ArenaView } from "@/components/arena-view";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { UpcomingView } from "@/components/upcoming-view";
import { MyBetsView } from "@/components/my-bets-view";
import { Button } from "@/components/ui/button";

type Tab = "arena" | "matches" | "leaderboard" | "bets";

interface UserInfo {
  id: string;
  name: string;
  computeTokens: number;
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("matches");
  const [viewingMatchId, setViewingMatchId] = useState<string | null>(null);

  // Fetch user for the token balance badge.
  const { data: userData, refetch: refetchUser } = useQuery<{ user: UserInfo }>({
    queryKey: ["user-balance"],
    queryFn: async () => {
      const r = await fetch("/api/user");
      return r.json();
    },
    refetchInterval: 5000,
  });

  // Auto-seed on first load so the page is never empty.
  useEffect(() => {
    fetch("/api/seed", { method: "POST" }).catch(() => {});
  }, []);

  // When a match is selected, switch to the arena tab.
  function viewMatch(matchId: string) {
    setViewingMatchId(matchId);
    setTab("arena");
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="text-2xl">♟️</div>
            <div>
              <h1 className="text-lg font-bold leading-tight">
                AI Chess Gladiator
              </h1>
              <p className="text-[11px] text-muted-foreground leading-tight">
                Where LLMs play chess badly. Bring popcorn.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border bg-yellow-50 dark:bg-yellow-950/30 border-yellow-300">
              <Coins className="w-4 h-4 text-yellow-600" />
              <span className="font-mono font-bold text-sm">
                {userData?.user?.computeTokens ?? "—"}
              </span>
              <span className="text-xs text-muted-foreground">tokens</span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => refetchUser()}
              title="Refresh balance"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList className="grid grid-cols-4 w-full max-w-md mb-6">
            <TabsTrigger value="matches">Matches</TabsTrigger>
            <TabsTrigger value="arena">Arena</TabsTrigger>
            <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
            <TabsTrigger value="bets">My Bets</TabsTrigger>
          </TabsList>

          <TabsContent value="matches" className="mt-0">
            <UpcomingView onViewMatch={viewMatch} canStart />
          </TabsContent>

          <TabsContent value="arena" className="mt-0">
            <ArenaView
              matchId={viewingMatchId}
              onBack={() => setTab("matches")}
            />
          </TabsContent>

          <TabsContent value="leaderboard" className="mt-0">
            <LeaderboardTable />
          </TabsContent>

          <TabsContent value="bets" className="mt-0">
            <MyBetsView />
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="border-t bg-card mt-auto">
        <div className="max-w-7xl mx-auto px-4 py-3 text-center text-xs text-muted-foreground">
          Phase 2 Web MVP · Built with Next.js + chess.js + z-ai-web-dev-sdk ·{" "}
          <span className="text-foreground font-medium">All matches are simulated AI-vs-AI duels.</span>
        </div>
      </footer>
    </div>
  );
}
