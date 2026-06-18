"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Coins, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { payoutMultiplier } from "@/lib/elo";

interface BidFormProps {
  matchId: string;
  whiteElo: number;
  blackElo: number;
  whiteName: string;
  blackName: string;
  disabled?: boolean;
}

const QUICK_AMOUNTS = [10, 50, 100, 500];

export function BidForm({
  matchId,
  whiteElo,
  blackElo,
  whiteName,
  blackName,
  disabled,
}: BidFormProps) {
  const [side, setSide] = useState<"white" | "black">("white");
  const [amount, setAmount] = useState<number>(50);
  const [submitting, setSubmitting] = useState(false);
  const qc = useQueryClient();

  const mult = payoutMultiplier(whiteElo, blackElo, side);
  const potential = Math.round(amount * mult);

  async function submit() {
    if (disabled || submitting) return;
    setSubmitting(true);
    try {
      const r = await fetch("/api/bets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, side, amount }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Failed to place bet");
      toast.success(
        `Bet placed: ${amount} tokens on ${side === "white" ? whiteName : blackName}. ` +
          `Potential payout: ${j.potentialPayout} tokens.`
      );
      qc.invalidateQueries({ queryKey: ["user"] });
      qc.invalidateQueries({ queryKey: ["matches"] });
      qc.invalidateQueries({ queryKey: ["bets"] });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <BidSideButton
          active={side === "white"}
          onClick={() => setSide("white")}
          label={whiteName}
          subtitle={`Elo ${whiteElo}`}
          color="white"
          multiplier={payoutMultiplier(whiteElo, blackElo, "white")}
        />
        <BidSideButton
          active={side === "black"}
          onClick={() => setSide("black")}
          label={blackName}
          subtitle={`Elo ${blackElo}`}
          color="black"
          multiplier={payoutMultiplier(whiteElo, blackElo, "black")}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="amount" className="text-xs">
          Wager (Compute Tokens)
        </Label>
        <div className="flex items-center gap-2">
          <Coins className="w-4 h-4 text-yellow-600" />
          <Input
            id="amount"
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(Math.max(1, Number(e.target.value) || 0))}
            disabled={disabled}
            className="font-mono"
          />
        </div>
        <div className="flex gap-1 mt-1">
          {QUICK_AMOUNTS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setAmount(q)}
              disabled={disabled}
              className="px-2 py-1 text-xs rounded border hover:bg-accent disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between text-xs p-2 rounded bg-muted/40">
        <span className="text-muted-foreground">
          {amount} × {mult}x
        </span>
        <ArrowRight className="w-3 h-3 text-muted-foreground" />
        <span className="font-mono font-bold text-green-600">
          {potential} tokens
        </span>
      </div>

      <Button
        onClick={submit}
        disabled={disabled || submitting || amount <= 0}
        className="w-full"
      >
        {submitting
          ? "Placing bet..."
          : `Bet ${amount} on ${side === "white" ? whiteName : blackName}`}
      </Button>
    </div>
  );
}

function BidSideButton({
  active,
  onClick,
  label,
  subtitle,
  color,
  multiplier,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  subtitle: string;
  color: "white" | "black";
  multiplier: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-2.5 rounded-lg border-2 transition-all ${
        active
          ? color === "white"
            ? "border-zinc-900 bg-zinc-100 dark:border-zinc-100 dark:bg-zinc-800"
            : "border-zinc-100 bg-zinc-900"
          : "border-border hover:border-foreground/40"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className={`w-3 h-3 rounded-full ${color === "white" ? "bg-white border border-zinc-300" : "bg-zinc-900"}`} />
        <span className="text-[10px] font-mono text-muted-foreground">
          {mult(multiplier)}
        </span>
      </div>
      <div className="text-sm font-semibold mt-1 truncate">{label}</div>
      <div className="text-[10px] text-muted-foreground">{subtitle}</div>
    </button>
  );
}

function mult(m: number): string {
  return `${m.toFixed(2)}x`;
}
