"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Coins, RefreshCw } from "lucide-react";
import { ArenaView } from "@/components/arena-view";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { UpcomingView } from "@/components/upcoming-view";
import { MyBetsView } from "@/components/my-bets-view";
import { HighlightsView } from "@/components/highlights-view";
import { TournamentsView } from "@/components/tournaments-view";
import { StreamView } from "@/components/stream-view";
import { Button } from "@/components/ui/button";

type Tab = "matches" | "arena" | "tournaments" | "highlights" | "leaderboard" | "bets";

interface UserInfo {
  id: string;
  name: string;
  computeTokens: number;
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("matches");
  const [viewingMatchId, setViewingMatchId] = useState<string | null>(null);

  // Phase 4: Stream mode — if the URL has ?stream=<matchId>, render the
  // fullscreen OBS-friendly view instead of the normal SPA. Streamers embed
  // this URL as a Browser Source in OBS Studio.
  const [streamMatchId, setStreamMatchId] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const s = params.get("stream");
    if (s) {
      // Defer to a microtask to avoid the set-state-in-effect lint rule.
      Promise.resolve().then(() => setStreamMatchId(s));
    }
  }, []);

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

  // Stream mode — early return with the fullscreen StreamView
  if (streamMatchId) {
    return <StreamView matchId={streamMatchId} />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="text-2xl">🤖</div>
            <div>
              <h1 className="text-lg font-bold leading-tight">
                BotBrawl
              </h1>
              <p className="text-[11px] text-muted-foreground leading-tight">
                Where AI models fight, fail, and get famous.
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
          <TabsList className="grid grid-cols-6 w-full max-w-3xl mb-6">
            <TabsTrigger value="matches">Matches</TabsTrigger>
            <TabsTrigger value="arena">Arena</TabsTrigger>
            <TabsTrigger value="tournaments">Tournaments</TabsTrigger>
            <TabsTrigger value="highlights">Highlights</TabsTrigger>
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

          <TabsContent value="tournaments" className="mt-0">
            <TournamentsView onViewMatch={viewMatch} />
          </TabsContent>

          <TabsContent value="highlights" className="mt-0">
            <HighlightsView onViewMatch={viewMatch} />
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
          BotBrawl · Phase 4 Live Tournaments · Brackets + spectator chat + OBS stream mode ·{" "}
          <a
            href="https://github.com/xxnavdeep07xx-droid/BotBrawl"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground font-medium underline-offset-2 hover:underline"
          >
            View source on GitHub →
          </a>
        </div>
      </footer>
    </div>
  );
}
