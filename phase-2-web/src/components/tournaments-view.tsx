"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trophy, Plus, Play, Loader2, Crown, Swords } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

interface TournamentInfo {
  id: string;
  name: string;
  size: number;
  status: "UPCOMING" | "ACTIVE" | "COMPLETED";
  currentRound: number;
  winnerId: string | null;
  createdAt: string;
  _count: { matches: number };
}

interface AIPlayer {
  id: string;
  name: string;
  personaKey: string;
  elo: number;
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

interface TournamentsViewProps {
  onViewMatch?: (matchId: string) => void;
}

export function TournamentsView({ onViewMatch }: TournamentsViewProps) {
  const qc = useQueryClient();
  const [viewingId, setViewingId] = useState<string | null>(null);

  const { data: tournaments, isLoading } = useQuery<TournamentInfo[]>({
    queryKey: ["tournaments"],
    queryFn: async () => {
      const r = await fetch("/api/tournaments");
      const j = await r.json();
      return j.tournaments;
    },
    refetchInterval: 5000,
  });

  const all = tournaments ?? [];
  const active = all.filter((t) => t.status === "ACTIVE");
  const upcoming = all.filter((t) => t.status === "UPCOMING");
  const completed = all.filter((t) => t.status === "COMPLETED");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Trophy className="w-5 h-5 text-yellow-600" />
            Tournaments
          </h2>
          <p className="text-sm text-muted-foreground">
            Single-elimination AI brackets. 4 or 8 gladiators. One champion.
          </p>
        </div>
        <CreateTournamentDialog onCreated={(id) => setViewingId(id)} />
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading tournaments...
        </div>
      )}

      {!isLoading && all.length === 0 && (
        <div className="text-center py-16 text-muted-foreground border border-dashed rounded-lg">
          <div className="text-4xl mb-3">🏆</div>
          <div className="font-semibold text-foreground">No tournaments yet</div>
          <div className="text-sm mt-1 max-w-md mx-auto">
            Click <strong>New Tournament</strong> above to set up your first AI bracket.
            Pick 4 or 8 AI gladiators, hit start, and watch them eliminate each other.
          </div>
        </div>
      )}

      {viewingId && (
        <BracketView tournamentId={viewingId} onViewMatch={onViewMatch} />
      )}

      {!viewingId && active.length > 0 && (
        <Section title="🔴 Active" tournaments={active} onView={(id) => setViewingId(id)} />
      )}
      {!viewingId && upcoming.length > 0 && (
        <Section title="📅 Upcoming" tournaments={upcoming} onView={(id) => setViewingId(id)} />
      )}
      {!viewingId && completed.length > 0 && (
        <Section title="🏆 Completed" tournaments={completed} onView={(id) => setViewingId(id)} />
      )}
    </div>
  );
}

function Section({
  title,
  tournaments,
  onView,
}: {
  title: string;
  tournaments: TournamentInfo[];
  onView: (id: string) => void;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-muted-foreground mb-3">{title}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {tournaments.map((t) => (
          <TournamentCard key={t.id} tournament={t} onView={() => onView(t.id)} />
        ))}
      </div>
    </div>
  );
}

function TournamentCard({
  tournament,
  onView,
}: {
  tournament: TournamentInfo;
  onView: () => void;
}) {
  const statusBadge =
    tournament.status === "ACTIVE" ? (
      <Badge className="bg-red-600 text-white animate-pulse">LIVE</Badge>
    ) : tournament.status === "UPCOMING" ? (
      <Badge variant="secondary">Upcoming</Badge>
    ) : (
      <Badge variant="outline">Completed</Badge>
    );

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          {statusBadge}
          <span className="text-xs text-muted-foreground">
            {tournament.size}-AI bracket
          </span>
        </div>
        <h4 className="font-bold text-lg mb-1">{tournament.name}</h4>
        <div className="text-xs text-muted-foreground mb-3">
          {tournament.status === "ACTIVE" && `Round ${tournament.currentRound + 1} in progress`}
          {tournament.status === "UPCOMING" && "Not yet started"}
          {tournament.status === "COMPLETED" && tournament.winnerId && "Champion crowned!"}
        </div>
        <Button size="sm" variant="outline" onClick={onView} className="w-full">
          {tournament.status === "COMPLETED" ? "View Bracket" : "View Bracket"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Create Tournament dialog
// ---------------------------------------------------------------------------

function CreateTournamentDialog({ onCreated }: { onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [size, setSize] = useState<4 | 8>(4);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const qc = useQueryClient();

  const { data: players } = useQuery<AIPlayer[]>({
    queryKey: ["players-tournament"],
    queryFn: async () => {
      const r = await fetch("/api/leaderboard");
      const j = await r.json();
      return j.players;
    },
  });

  const togglePlayer = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= size) return prev; // can't exceed size
      return [...prev, id];
    });
  };

  const canSubmit = name.trim() && selectedIds.length === size && !submitting;

  async function handleCreate() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const r = await fetch("/api/tournaments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, size, playerIds: selectedIds }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Failed to create tournament");
      toast.success(`Tournament "${name}" created!`);
      qc.invalidateQueries({ queryKey: ["tournaments"] });
      setOpen(false);
      setName("");
      setSelectedIds([]);
      onCreated(j.tournament.id);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="w-4 h-4 mr-1" />
          New Tournament
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="w-5 h-5" />
            New Tournament
          </DialogTitle>
          <DialogDescription>
            Single-elimination bracket. Pick {size} AI gladiators. The bracket
            seeds automatically by Elo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="t-name">Tournament Name</Label>
            <Input
              id="t-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. BotBrawl Inaugural Cup"
            />
          </div>

          <div className="space-y-2">
            <Label>Bracket Size</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={size === 4 ? "default" : "outline"}
                onClick={() => {
                  setSize(4);
                  setSelectedIds((prev) => prev.slice(0, 4));
                }}
              >
                4 AIs (2 rounds)
              </Button>
              <Button
                type="button"
                variant={size === 8 ? "default" : "outline"}
                onClick={() => {
                  setSize(8);
                  setSelectedIds((prev) => prev.slice(0, 8));
                }}
              >
                8 AIs (3 rounds)
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>
              Select {size} Players ({selectedIds.length}/{size} selected)
            </Label>
            <div className="max-h-60 overflow-y-auto space-y-1 border rounded p-2">
              {players?.map((p) => {
                const selected = selectedIds.includes(p.id);
                const disabled = !selected && selectedIds.length >= size;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => togglePlayer(p.id)}
                    disabled={disabled}
                    className={`w-full text-left p-2 rounded border transition-colors ${
                      selected
                        ? "border-primary bg-primary/10"
                        : disabled
                        ? "border-border opacity-50 cursor-not-allowed"
                        : "border-border hover:border-foreground/40"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-sm">{p.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {PERSONA_LABELS[p.personaKey] ?? p.personaKey} · Elo {p.elo}
                        </div>
                      </div>
                      {selected && <span className="text-primary text-sm">✓</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!canSubmit}>
            {submitting ? "Creating..." : "Create Tournament"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Bracket view — fetches the bracket and renders it as columns
// ---------------------------------------------------------------------------

interface BracketData {
  tournament: {
    id: string;
    name: string;
    size: number;
    status: string;
    currentRound: number;
    winnerId: string | null;
  };
  rounds: {
    round: number;
    label: string;
    matches: {
      id: string;
      bracketIndex: number;
      status: string;
      matchId: string | null;
      matchStatus: string | null;
      matchWinner: string | null;
      whiteSlot: {
        seed: number;
        playerName: string;
        playerElo: number;
        winner: boolean;
      } | null;
      blackSlot: {
        seed: number;
        playerName: string;
        playerElo: number;
        winner: boolean;
      } | null;
    }[];
  }[];
}

function BracketView({
  tournamentId,
  onViewMatch,
}: {
  tournamentId: string;
  onViewMatch?: (matchId: string) => void;
}) {
  const qc = useQueryClient();
  const [advancing, setAdvancing] = useState(false);

  const { data: bracket, isLoading } = useQuery<BracketData>({
    queryKey: ["bracket", tournamentId],
    queryFn: async () => {
      const r = await fetch(`/api/tournaments/${tournamentId}`);
      const j = await r.json();
      return j.bracket;
    },
    refetchInterval: (query) => {
      const d = query.state.data;
      return d?.tournament.status === "ACTIVE" ? 3000 : false;
    },
  });

  async function startOrAdvance() {
    setAdvancing(true);
    try {
      // If there's a LIVE match, this is a no-op (we'll let the user click View).
      // Otherwise, schedule the next READY match.
      const r = await fetch(`/api/tournaments/${tournamentId}/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Failed to advance");
      if (j.tournamentComplete) {
        toast.success("Tournament complete! 🏆");
      } else if (j.nextMatch) {
        toast.success("Match scheduled — click Play to start it.");
      } else {
        toast.info(j.message ?? "No matches ready yet.");
      }
      qc.invalidateQueries({ queryKey: ["bracket", tournamentId] });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setAdvancing(false);
    }
  }

  if (isLoading || !bracket) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const t = bracket.tournament;
  const hasLiveMatch = bracket.rounds.some((r) =>
    r.matches.some((m) => m.matchStatus === "LIVE")
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2">
            {t.status === "COMPLETED" && <Crown className="w-5 h-5 text-yellow-600" />}
            {t.name}
          </CardTitle>
          <div className="flex items-center gap-2">
            {t.status === "UPCOMING" && (
              <Button onClick={startOrAdvance} disabled={advancing}>
                {advancing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Play className="w-4 h-4 mr-1" />}
                Start Tournament
              </Button>
            )}
            {t.status === "ACTIVE" && !hasLiveMatch && (
              <Button onClick={startOrAdvance} disabled={advancing}>
                {advancing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Swords className="w-4 h-4 mr-1" />}
                Schedule Next Match
              </Button>
            )}
            {t.status === "ACTIVE" && hasLiveMatch && (
              <Badge className="bg-red-600 text-white animate-pulse">Match Live</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto pb-4">
          <div className="flex gap-6 min-w-max">
            {bracket.rounds.map((round) => (
              <div key={round.round} className="flex flex-col justify-around min-w-[200px]">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 text-center">
                  {round.label}
                </h4>
                <div className="flex-1 flex flex-col justify-around gap-3">
                  {round.matches.map((m) => (
                    <BracketMatchCard
                      key={m.id}
                      match={m}
                      onViewMatch={onViewMatch}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function BracketMatchCard({
  match,
  onViewMatch,
}: {
  match: BracketData["rounds"][0]["matches"][0];
  onViewMatch?: (matchId: string) => void;
}) {
  const isLive = match.matchStatus === "LIVE";
  const isCompleted = match.status === "COMPLETED";
  const isReady = match.status === "READY";
  const isPending = match.status === "PENDING";

  return (
    <div
      className={`border rounded p-2 text-xs ${
        isLive
          ? "border-red-500 shadow-md shadow-red-500/20"
          : isCompleted
          ? "border-border"
          : isReady
          ? "border-green-500"
          : "border-dashed border-border opacity-70"
      }`}
    >
      <SlotRow slot={match.whiteSlot} isLive={isLive} />
      <div className="text-[10px] text-muted-foreground text-center my-0.5">vs</div>
      <SlotRow slot={match.blackSlot} isLive={isLive} />

      <div className="mt-2 pt-2 border-t flex items-center justify-between">
        {isPending && <span className="text-muted-foreground text-[10px]">Awaiting winners</span>}
        {isReady && <span className="text-green-600 text-[10px] font-semibold">Ready</span>}
        {isLive && <span className="text-red-600 text-[10px] font-semibold animate-pulse">● LIVE</span>}
        {isCompleted && <span className="text-[10px] text-muted-foreground">Done</span>}
        {match.matchId && (
          <Button
            size="sm"
            variant="ghost"
            className="h-5 px-1 text-[10px]"
            onClick={() => onViewMatch?.(match.matchId!)}
          >
            View →
          </Button>
        )}
      </div>
    </div>
  );
}

function SlotRow({
  slot,
  isLive,
}: {
  slot: {
    seed: number;
    playerName: string;
    playerElo: number;
    winner: boolean;
  } | null;
  isLive: boolean;
}) {
  if (!slot) {
    return (
      <div className="flex items-center gap-1.5 py-1 opacity-50">
        <span className="w-4 text-[10px] text-right">—</span>
        <span className="text-muted-foreground italic">TBD</span>
      </div>
    );
  }
  return (
    <div className={`flex items-center gap-1.5 py-0.5 ${slot.winner ? "font-bold" : ""}`}>
      <span className="w-4 text-[10px] text-right text-muted-foreground">{slot.seed}</span>
      <span className={`flex-1 truncate ${slot.winner ? "text-foreground" : "text-muted-foreground"}`}>
        {slot.playerName}
      </span>
      {slot.winner && <span className="text-yellow-600">👑</span>}
      <span className="text-[10px] text-muted-foreground">{slot.playerElo}</span>
    </div>
  );
}
