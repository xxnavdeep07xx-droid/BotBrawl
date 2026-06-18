"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Swords } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

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

export function CreateMatchDialog({ onCreated }: { onCreated?: (matchId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [whiteId, setWhiteId] = useState<string>("");
  const [blackId, setBlackId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const qc = useQueryClient();

  const { data: players } = useQuery<AIPlayer[]>({
    queryKey: ["players-for-picker"],
    queryFn: async () => {
      const r = await fetch("/api/leaderboard");
      const j = await r.json();
      return j.players;
    },
  });

  const canSubmit = whiteId && blackId && whiteId !== blackId && !submitting;

  async function handleCreate() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const r = await fetch("/api/matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ whiteId, blackId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Failed to create match");
      toast.success("Match scheduled! Place your bets before it starts.");
      qc.invalidateQueries({ queryKey: ["matches"] });
      setOpen(false);
      setWhiteId("");
      setBlackId("");
      onCreated?.(j.match.id);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const white = players?.find((p) => p.id === whiteId);
  const black = players?.find((p) => p.id === blackId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="w-4 h-4 mr-1" />
          Schedule Match
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Swords className="w-5 h-5" />
            Schedule a New Match
          </DialogTitle>
          <DialogDescription>
            Pick two AI gladiators to face off. You'll be able to bet Compute Tokens
            on the winner before the match starts.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="white">White Player</Label>
            <Select value={whiteId} onValueChange={setWhiteId}>
              <SelectTrigger id="white">
                <SelectValue placeholder="Choose white..." />
              </SelectTrigger>
              <SelectContent>
                {players
                  ?.filter((p) => p.id !== blackId)
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} · {PERSONA_LABELS[p.personaKey]} · Elo {p.elo}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="text-center text-muted-foreground text-xs">vs</div>

          <div className="space-y-2">
            <Label htmlFor="black">Black Player</Label>
            <Select value={blackId} onValueChange={setBlackId}>
              <SelectTrigger id="black">
                <SelectValue placeholder="Choose black..." />
              </SelectTrigger>
              <SelectContent>
                {players
                  ?.filter((p) => p.id !== whiteId)
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} · {PERSONA_LABELS[p.personaKey]} · Elo {p.elo}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {white && black && (
            <div className="text-xs text-muted-foreground text-center p-2 border rounded bg-muted/30">
              {white.name} (Elo {white.elo}) vs {black.name} (Elo {black.elo})
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!canSubmit}>
            {submitting ? "Scheduling..." : "Schedule Match"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
