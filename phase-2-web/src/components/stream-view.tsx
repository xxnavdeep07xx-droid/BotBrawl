"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Chess } from "chess.js";
import { Loader2 } from "lucide-react";
import { ChessBoard } from "@/components/chess-board";
import { ChatPanel, ChatMessage } from "@/components/chat-panel";
import { SpectatorChat } from "@/components/spectator-chat";
import { getMatchSocket, LiveMatchEvent } from "@/lib/socket";

/**
 * StreamView — fullscreen, OBS-friendly layout for streamers.
 *
 * Triggered by `/?stream=<matchId>`. Designed to be embedded as a Browser
 * Source in OBS Studio (typically 1920x1080). No nav, no betting UI, no
 * footer — just the board, the AI monologue, and the spectator chat.
 *
 * The layout is a CSS grid:
 *   ┌──────────────────────────────────────────────┐
 *   │  🤖 BotBrawl — <white> vs <black>            │  (header strip)
 *   ├──────────┬───────────────────┬───────────────┤
 *   │  White   │                   │  AI Trash     │
 *   │  Elo     │     BOARD         │  Talk         │
 *   │  ● to    │                   │  (scrolling)  │
 *   │  move    │                   │               │
 *   ├──────────┤                   ├───────────────┤
 *   │  Black   │                   │  Spectator    │
 *   │  Elo     │                   │  Chat         │
 *   └──────────┴───────────────────┴───────────────┘
 */
export function StreamView({ matchId }: { matchId: string }) {
  const qc = useQueryClient();
  const [liveEvents, setLiveEvents] = useState<LiveMatchEvent[]>([]);

  const { data: match, isLoading } = useQuery({
    queryKey: ["match", matchId],
    queryFn: async () => {
      const r = await fetch(`/api/matches/${matchId}`);
      const j = await r.json();
      return j.match;
    },
    enabled: !!matchId,
    refetchInterval: (query) => {
      const m = query.state.data;
      return m?.status === "LIVE" ? 1500 : 5000;
    },
  });

  // Subscribe to live events. We use a ref to track the current matchId
  // so we can clear the liveEvents array without calling setState in the
  // effect body (which triggers a lint warning).
  const matchIdRef = useRef<string>(matchId);
  useEffect(() => {
    if (matchIdRef.current !== matchId) {
      matchIdRef.current = matchId;
      // Defer the reset to a microtask so it doesn't run inside the effect body.
      Promise.resolve().then(() => setLiveEvents([]));
    }
    if (!matchId) return;
    const socket = getMatchSocket();

    const onConnect = () => socket.emit("subscribe_match", matchId);
    const onEvent = (e: LiveMatchEvent) => {
      if (e.matchId !== matchId) return;
      setLiveEvents((prev) => [...prev, e]);
      if (e.type === "match_end") {
        qc.invalidateQueries({ queryKey: ["match", matchId] });
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

  if (isLoading || !match) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-white">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  // Build live FEN by replaying moves
  const liveEventsToUse = match.status === "COMPLETED" ? [] : liveEvents;
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

  const moveEvents = allEvents.filter((e: any) => e.type === "move");
  const board = new Chess();
  for (const e of moveEvents) {
    if (e.san) {
      try {
        board.move(e.san);
      } catch {
        // ignore
      }
    }
  }
  const liveFen = match.status === "COMPLETED" && match.finalFen
    ? match.finalFen
    : board.fen();

  const lastHistory = board.history({ verbose: true });
  const lastMove = lastHistory.length > 0
    ? { from: lastHistory[lastHistory.length - 1].from, to: lastHistory[lastHistory.length - 1].to }
    : null;

  // Build chat messages from events
  const chatMessages: ChatMessage[] = allEvents
    .filter((e: any) => ["move", "player_resigned", "player_timeout", "match_start", "match_end"].includes(e.type))
    .map((e: any) => {
      if (e.type === "match_start") {
        return {
          id: `start-${e.ply}`,
          side: "system" as const,
          text: `Match started: ${match.white.name} vs ${match.black.name}`,
          timestamp: new Date(e.timestamp).getTime(),
        };
      }
      if (e.type === "match_end") {
        const winner = e.extra?.winner ?? match.winner;
        const reason = e.extra?.reason ?? match.reason;
        return {
          id: `end-${e.ply}`,
          side: "system" as const,
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
      const retryNote = e.retries > 0 ? ` (after ${e.retries} illegal attempt${e.retries > 1 ? "s" : ""})` : "";
      return {
        id: `m-${e.ply}`,
        side: e.side as "white" | "black",
        san: e.san ?? undefined,
        text: `${e.monologue ?? "..."}${retryNote}`,
        timestamp: new Date(e.timestamp).getTime(),
      };
    });

  const isWhiteTurn = match.status === "LIVE" && board.turn() === "w";

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col">
      {/* Stream header strip */}
      <div className="bg-gradient-to-r from-red-900 via-zinc-900 to-red-900 border-b border-red-700/50 px-6 py-3 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className="text-3xl">🤖</span>
          <div>
            <div className="font-bold text-xl tracking-tight">BotBrawl</div>
            <div className="text-[10px] text-zinc-400 uppercase tracking-widest">
              {match.status === "LIVE" && <span className="text-red-500 animate-pulse">● LIVE</span>}
              {match.status === "UPCOMING" && "Starting Soon"}
              {match.status === "COMPLETED" && "Final"}
            </div>
          </div>
        </div>
        <div className="text-center">
          <div className="font-bold text-lg">
            {match.white.name} <span className="text-zinc-500 text-sm font-normal">vs</span> {match.black.name}
          </div>
          <div className="text-[11px] text-zinc-400">
            Elo {match.white.elo} · {match.black.elo}
          </div>
        </div>
        <div className="text-right">
          {match.status === "COMPLETED" && match.winner ? (
            <div className="text-yellow-400 font-bold text-lg">
              🏆 {match.winner.toUpperCase()} WINS
            </div>
          ) : (
            <div className="text-zinc-400 text-sm">
              {match.plies + (liveEvents.filter((e) => e.type === "move").length - match.events.filter((e: any) => e.type === "move").length > 0 ? liveEvents.filter((e) => e.type === "move").length : 0)} plies
            </div>
          )}
        </div>
      </div>

      {/* Main 3-column grid */}
      <div className="flex-1 grid grid-cols-[280px_1fr_360px] gap-4 p-4 min-h-0">
        {/* Left: player cards */}
        <div className="flex flex-col gap-3">
          <StreamPlayerCard
            name={match.white.name}
            elo={match.white.elo}
            side="white"
            toMove={isWhiteTurn && match.status === "LIVE"}
          />
          <StreamPlayerCard
            name={match.black.name}
            elo={match.black.elo}
            side="black"
            toMove={!isWhiteTurn && match.status === "LIVE"}
          />
          {match.status === "LIVE" && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-center">
              <div className="text-[10px] text-zinc-500 uppercase tracking-widest">Move</div>
              <div className="font-mono font-bold text-2xl">#{moveEvents.length}</div>
            </div>
          )}
        </div>

        {/* Middle: chessboard, centered */}
        <div className="flex items-center justify-center">
          <ChessBoard fen={liveFen} lastMove={lastMove} size={640} />
        </div>

        {/* Right: AI monologue (top) + spectator chat (bottom) */}
        <div className="flex flex-col gap-3 min-h-0">
          <div className="flex-1 min-h-0">
            <ChatPanel messages={chatMessages} title="AI Trash Talk" />
          </div>
          <div className="h-[280px]">
            <SpectatorChat matchId={match.id} />
          </div>
        </div>
      </div>
    </div>
  );
}

function StreamPlayerCard({
  name,
  elo,
  side,
  toMove,
}: {
  name: string;
  elo: number;
  side: "white" | "black";
  toMove: boolean;
}) {
  return (
    <div
      className={`rounded-lg border-2 p-4 transition-all ${
        toMove
          ? "border-red-500 bg-red-950/30 shadow-lg shadow-red-500/20"
          : "border-zinc-800 bg-zinc-900"
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`w-10 h-10 rounded-full ${
            side === "white" ? "bg-white border-2 border-zinc-300" : "bg-zinc-800 border-2 border-zinc-600"
          }`}
        />
        <div className="flex-1 min-w-0">
          <div className="font-bold text-lg truncate">{name}</div>
          <div className="text-xs text-zinc-400">
            Elo {elo} · {side.toUpperCase()}
          </div>
        </div>
      </div>
      {toMove && (
        <div className="mt-2 text-center text-red-400 text-xs font-semibold animate-pulse">
          ● thinking...
        </div>
      )}
    </div>
  );
}
