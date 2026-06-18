"use client";

import { useEffect, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Chess } from "chess.js";
import { Play, RotateCcw, Loader2, ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChessBoard } from "@/components/chess-board";
import { ChatPanel, ChatMessage } from "@/components/chat-panel";
import { BidForm } from "@/components/bid-form";
import { toast } from "sonner";
import { getMatchSocket, LiveMatchEvent } from "@/lib/socket";

const PERSONA_LABELS: Record<string, string> = {
  apologetic: "The Apologetic Strategist",
  overconfident: "The Delusional Grandmaster",
  cheater: "The Rules Lawyer",
  philosopher: "The Chess Philosopher",
  streamer: "The Hype Streamer",
  doomer: "The Doomer",
  robot: "The Cold Calculator",
};

interface MatchData {
  id: string;
  status: "UPCOMING" | "LIVE" | "COMPLETED";
  winner: "white" | "black" | null;
  reason: string | null;
  plies: number;
  finalFen: string | null;
  pgn: string | null;
  white: { id: string; name: string; elo: number; personaKey: string };
  black: { id: string; name: string; elo: number; personaKey: string };
  events: {
    id: string;
    ply: number;
    side: string;
    type: string;
    san: string | null;
    monologue: string | null;
    retries: number;
    apiErrors: number;
    elapsedMs: number;
    timestamp: string;
  }[];
  bets: { id: string; side: string; amount: number; status: string; payout: number | null }[];
}

interface ArenaViewProps {
  matchId: string | null;
  onBack?: () => void;
}

export function ArenaView({ matchId, onBack }: ArenaViewProps) {
  const qc = useQueryClient();
  const [starting, setStarting] = useState(false);
  const [liveEvents, setLiveEvents] = useState<LiveMatchEvent[]>([]);

  // Fetch the match + its events.
  const { data: match, isLoading } = useQuery<MatchData>({
    queryKey: ["match", matchId],
    queryFn: async () => {
      const r = await fetch(`/api/matches/${matchId}`);
      const j = await r.json();
      return j.match;
    },
    enabled: !!matchId,
    refetchInterval: (query) => {
      // Poll every 1.5s while LIVE, otherwise rely on WebSocket.
      const m = query.state.data;
      return m?.status === "LIVE" ? 1500 : false;
    },
  });

  // WebSocket subscription for live events.
  useEffect(() => {
    if (!matchId) return;
    setLiveEvents([]);
    const socket = getMatchSocket();

    const onConnect = () => socket.emit("subscribe_match", matchId);
    const onEvent = (e: LiveMatchEvent) => {
      if (e.matchId !== matchId) return;
      setLiveEvents((prev) => [...prev, e]);
      if (e.type === "match_end") {
        qc.invalidateQueries({ queryKey: ["match", matchId] });
        qc.invalidateQueries({ queryKey: ["matches"] });
        qc.invalidateQueries({ queryKey: ["leaderboard"] });
        qc.invalidateQueries({ queryKey: ["user"] });
        toast.success(
          e.extra?.winner
            ? `${e.extra.winner.toUpperCase()} wins!`
            : "Match ended in a draw."
        );
      }
    };

    if (socket.connected) onConnect();
    else socket.on("connect", onConnect);
    socket.on("match_event", onEvent);

    return () => {
      socket.off("connect", onConnect);
      socket.off("match_event", onEvent);
      socket.emit("unsubscribe_match", matchId);
    };
  }, [matchId, qc]);

  const startMatch = useCallback(async () => {
    if (!matchId) return;
    setStarting(true);
    try {
      const r = await fetch(`/api/matches/${matchId}/start`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Failed to start match");
      toast.success("Match is now LIVE!");
      qc.invalidateQueries({ queryKey: ["match", matchId] });
      qc.invalidateQueries({ queryKey: ["matches"] });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setStarting(false);
    }
  }, [matchId, qc]);

  if (!matchId) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground">
          <div className="text-4xl mb-3">♟️</div>
          <div className="font-semibold text-foreground">No match selected</div>
          <div className="text-sm mt-1">
            Schedule a match from the Upcoming tab, then come back here to watch it live.
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading || !match) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // Build the live FEN by replaying SAN moves from stored events + live events.
  // Skip live events entirely once the match is COMPLETED — they're already in
  // match.events by then, and adding them again would duplicate moves.
  const liveEventsToUse =
    match.status === "COMPLETED" ? [] : liveEvents;
  const allEvents = [
    ...match.events,
    ...liveEventsToUse.map((e) => ({
      id: `live-${e.ply}-${e.type}`,
      ply: e.ply,
      side: e.side,
      type: e.type,
      san: e.san ?? null,
      monologue: e.monologue ?? null,
      retries: e.retries ?? 0,
      apiErrors: e.apiErrors ?? 0,
      elapsedMs: e.elapsedMs ?? 0,
      timestamp: new Date(e.timestamp).toISOString(),
    })),
  ];

  const moveEvents = allEvents.filter((e) => e.type === "move");
  const board = new Chess();
  for (const e of moveEvents) {
    if (e.san) {
      try {
        board.move(e.san);
      } catch {
        // shouldn't happen — engine validated — but be defensive
      }
    }
  }
  const liveFen = match.status === "COMPLETED" && match.finalFen
    ? match.finalFen
    : board.fen();

  // Last-move highlight — chess.js tracks full move history with from/to
  // already attached, so we just read the last entry instead of replaying.
  let lastMove: { from: string; to: string } | null = null;
  const verboseHistory = board.history({ verbose: true });
  if (verboseHistory.length > 0) {
    const lastEntry = verboseHistory[verboseHistory.length - 1];
    lastMove = { from: lastEntry.from, to: lastEntry.to };
  }

  // Build chat messages from events.
  const chatMessages: ChatMessage[] = allEvents
    .filter((e) => e.type === "move" || e.type === "player_resigned" || e.type === "player_timeout" || e.type === "match_start" || e.type === "match_end")
    .map((e) => {
      if (e.type === "match_start") {
        return {
          id: `start-${e.ply}`,
          side: "system",
          text: `Match started: ${match.white.name} vs ${match.black.name}`,
          timestamp: new Date(e.timestamp).getTime(),
        };
      }
      if (e.type === "match_end") {
        const winner = (e as any).extra?.winner ?? match.winner;
        const reason = (e as any).extra?.reason ?? match.reason;
        return {
          id: `end-${e.ply}`,
          side: "system",
          text: winner ? `${winner.toUpperCase()} wins. ${reason ?? ""}` : `Draw. ${reason ?? ""}`,
          timestamp: new Date(e.timestamp).getTime(),
        };
      }
      if (e.type === "player_resigned" || e.type === "player_timeout") {
        return {
          id: `r-${e.ply}`,
          side: e.side as "white" | "black",
          text: e.monologue ?? "[resigned]",
          timestamp: new Date(e.timestamp).getTime(),
        };
      }
      // move
      const retryNote = e.retries > 0 ? ` (after ${e.retries} illegal attempt${e.retries > 1 ? "s" : ""})` : "";
      return {
        id: `m-${e.ply}`,
        side: e.side as "white" | "black",
        san: e.san ?? undefined,
        text: `${e.monologue ?? "..."}${retryNote}`,
        timestamp: new Date(e.timestamp).getTime(),
      };
    });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {onBack && (
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
          )}
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              {match.white.name}
              <span className="text-muted-foreground text-sm font-normal">vs</span>
              {match.black.name}
            </h2>
            <p className="text-xs text-muted-foreground">
              {PERSONA_LABELS[match.white.personaKey]} vs {PERSONA_LABELS[match.black.personaKey]}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {match.status === "UPCOMING" && (
            <Button onClick={startMatch} disabled={starting}>
              {starting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" /> Starting...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-1" /> Start Match
                </>
              )}
            </Button>
          )}
          {match.status === "LIVE" && (
            <Badge className="bg-red-600 hover:bg-red-700 text-white animate-pulse">
              ● LIVE · {match.plies + moveEvents.filter((e) => !match.events.find((me) => me.id === e.id)).length} plies
            </Badge>
          )}
          {match.status === "COMPLETED" && (
            <Badge variant="outline">
              {match.winner ? `${match.winner.toUpperCase()} won` : "Draw"}
            </Badge>
          )}
        </div>
      </div>

      {/* Main grid: board + chat + sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr_300px] gap-4">
        {/* Board column */}
        <div className="space-y-3">
          <PlayerBar name={match.white.name} elo={match.white.elo} side="white" turn={match.status === "LIVE" && board.turn() === "w"} />
          <ChessBoard fen={liveFen} lastMove={lastMove} size={480} />
          <PlayerBar name={match.black.name} elo={match.black.elo} side="black" turn={match.status === "LIVE" && board.turn() === "b"} />

          {match.status === "COMPLETED" && match.pgn && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Show PGN
              </summary>
              <pre className="mt-2 p-2 bg-muted rounded text-[10px] overflow-x-auto">
                {match.pgn}
              </pre>
            </details>
          )}
        </div>

        {/* Chat column */}
        <div className="min-h-[560px] h-[560px]">
          <ChatPanel messages={chatMessages} title="Live AI Trash Talk" />
        </div>

        {/* Bid sidebar */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                💰 Place a Bet
              </CardTitle>
            </CardHeader>
            <CardContent>
              {match.status === "UPCOMING" ? (
                <BidForm
                  matchId={match.id}
                  whiteElo={match.white.elo}
                  blackElo={match.black.elo}
                  whiteName={match.white.name}
                  blackName={match.black.name}
                />
              ) : (
                <div className="text-center py-4 text-sm text-muted-foreground">
                  {match.status === "LIVE"
                    ? "🔒 Betting closed — match is live."
                    : "🔒 Betting closed — match completed."}
                </div>
              )}

              {/* Existing bets summary */}
              {match.bets.length > 0 && (
                <div className="mt-4 pt-3 border-t">
                  <div className="text-xs font-semibold mb-2 text-muted-foreground">
                    All Bets ({match.bets.length})
                  </div>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {match.bets.map((bet) => (
                      <div key={bet.id} className="flex items-center justify-between text-xs">
                        <span className="font-mono">
                          {bet.amount} on {bet.side === "white" ? match.white.name : match.black.name}
                        </span>
                        <BetStatusBadge status={bet.status} payout={bet.payout} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function PlayerBar({ name, elo, side, turn }: { name: string; elo: number; side: "white" | "black"; turn: boolean }) {
  return (
    <div className={`flex items-center gap-2 p-2 rounded border ${turn ? "border-red-500 bg-red-50 dark:bg-red-950/20" : "border-border"}`}>
      <div className={`w-4 h-4 rounded-full ${side === "white" ? "bg-white border border-zinc-300" : "bg-zinc-900"}`} />
      <span className="font-semibold text-sm">{name}</span>
      <span className="text-xs text-muted-foreground">Elo {elo}</span>
      {turn && <span className="ml-auto text-xs text-red-600 font-bold animate-pulse">● to move</span>}
    </div>
  );
}

function BetStatusBadge({ status, payout }: { status: string; payout: number | null }) {
  if (status === "WON") return <Badge className="text-[10px] bg-green-600 text-white">+{payout ?? 0}</Badge>;
  if (status === "LOST") return <Badge variant="secondary" className="text-[10px]">lost</Badge>;
  if (status === "DRAWN") return <Badge variant="outline" className="text-[10px]">refunded</Badge>;
  return <Badge variant="outline" className="text-[10px]">pending</Badge>;
}
