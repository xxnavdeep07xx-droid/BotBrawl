"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock, Play, Eye, Swords } from "lucide-react";

export interface MatchInfo {
  id: string;
  status: "UPCOMING" | "LIVE" | "COMPLETED";
  winner: "white" | "black" | null;
  reason: string | null;
  plies: number;
  white: { id: string; name: string; elo: number; personaKey: string };
  black: { id: string; name: string; elo: number; personaKey: string };
  bets: { id: string; side: string; amount: number }[];
  startedAt: string | null;
  completedAt: string | null;
}

const PERSONA_LABELS: Record<string, string> = {
  apologetic: "Apologetic",
  overconfident: "Delusional GM",
  cheater: "Rules Lawyer",
  philosopher: "Philosopher",
  streamer: "Hype Streamer",
  doomer: "Doomer",
  robot: "Cold Calculator",
};

interface MatchCardProps {
  match: MatchInfo;
  onView?: (matchId: string) => void;
  onStart?: (matchId: string) => void;
  canStart?: boolean;
}

export function MatchCard({ match, onView, onStart, canStart }: MatchCardProps) {
  const totalPool = match.bets.reduce((s, b) => s + b.amount, 0);
  const whiteBets = match.bets.filter((b) => b.side === "white").reduce((s, b) => s + b.amount, 0);
  const blackBets = match.bets.filter((b) => b.side === "black").reduce((s, b) => s + b.amount, 0);

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <StatusBadge status={match.status} />
          <span className="text-xs text-muted-foreground font-mono">
            {match.id.slice(-6)}
          </span>
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center mb-3">
          <PlayerTag name={match.white.name} elo={match.white.elo} persona={match.white.personaKey} side="white" winner={match.winner === "white"} />
          <div className="text-center">
            <Swords className="w-4 h-4 text-muted-foreground mx-auto" />
            <div className="text-[10px] text-muted-foreground mt-0.5">vs</div>
          </div>
          <PlayerTag name={match.black.name} elo={match.black.elo} persona={match.black.personaKey} side="black" winner={match.winner === "black"} />
        </div>

        {/* Betting pool bar */}
        {totalPool > 0 && (
          <div className="mb-3">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
              <span>Pool: {totalPool} tokens</span>
              {match.status === "COMPLETED" && (
                <span>{match.reason}</span>
              )}
            </div>
            <div className="h-2 rounded-full overflow-hidden flex bg-muted">
              <div
                className="bg-zinc-100 dark:bg-zinc-300 border-r border-zinc-300"
                style={{ width: `${(whiteBets / totalPool) * 100}%` }}
              />
              <div
                className="bg-zinc-900 dark:bg-zinc-700"
                style={{ width: `${(blackBets / totalPool) * 100}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] mt-0.5">
              <span className="text-zinc-600 dark:text-zinc-300">{whiteBets} on white</span>
              <span className="text-zinc-600 dark:text-zinc-300">{blackBets} on black</span>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            {match.status === "UPCOMING" && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" /> Awaiting start
              </span>
            )}
            {match.status === "LIVE" && <span className="text-red-600 font-semibold animate-pulse">● LIVE</span>}
            {match.status === "COMPLETED" && (
              <span>{match.plies} plies played</span>
            )}
          </div>
          <div className="flex gap-1.5">
            {canStart && match.status === "UPCOMING" && (
              <Button size="sm" onClick={() => onStart?.(match.id)}>
                <Play className="w-3 h-3 mr-1" /> Start
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => onView?.(match.id)}>
              <Eye className="w-3 h-3 mr-1" /> View
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "UPCOMING") return <Badge variant="secondary">Upcoming</Badge>;
  if (status === "LIVE") return <Badge className="bg-red-600 hover:bg-red-700 text-white animate-pulse">LIVE</Badge>;
  return <Badge variant="outline">Completed</Badge>;
}

function PlayerTag({
  name,
  elo,
  persona,
  side,
  winner,
}: {
  name: string;
  elo: number;
  persona: string;
  side: "white" | "black";
  winner: boolean;
}) {
  return (
    <div className={`text-center p-2 rounded ${winner ? "ring-2 ring-yellow-400" : ""}`}>
      <div className={`w-6 h-6 rounded-full mx-auto mb-1 ${side === "white" ? "bg-white border border-zinc-300" : "bg-zinc-900"}`} />
      <div className="font-semibold text-sm truncate">{name}</div>
      <div className="text-[10px] text-muted-foreground">
        {PERSONA_LABELS[persona] ?? persona} · Elo {elo}
      </div>
    </div>
  );
}
