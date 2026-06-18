"use client";

import { useQuery } from "@tanstack/react-query";
import { Coins, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface BetInfo {
  id: string;
  side: string;
  amount: number;
  payout: number | null;
  status: string;
  createdAt: string;
  match: {
    id: string;
    status: string;
    winner: string | null;
    white: { id: string; name: string };
    black: { id: string; name: string };
  };
}

interface UserInfo {
  id: string;
  name: string;
  email: string;
  computeTokens: number;
  lastTokenGrant: string;
}

export function MyBetsView() {
  const { data } = useQuery<{ user: UserInfo; bets: BetInfo[] }>({
    queryKey: ["user"],
    queryFn: async () => {
      const r = await fetch("/api/user");
      return r.json();
    },
    refetchInterval: 5000,
  });

  const user = data?.user;
  const bets = data?.bets ?? [];

  // Stats
  const won = bets.filter((b) => b.status === "WON");
  const lost = bets.filter((b) => b.status === "LOST");
  const pending = bets.filter((b) => b.status === "PENDING");
  const totalWagered = bets.reduce((s, b) => s + b.amount, 0);
  const totalPayout = won.reduce((s, b) => s + (b.payout ?? 0), 0);
  const netProfit = totalPayout - totalWagered;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">My Bets</h2>
        <p className="text-sm text-muted-foreground">
          Your Compute Token balance and bet history.
        </p>
      </div>

      {/* Balance + stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Token Balance</div>
            <div className="text-2xl font-bold flex items-center gap-1">
              <Coins className="w-5 h-5 text-yellow-600" />
              {user?.computeTokens ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Total Wagered</div>
            <div className="text-2xl font-bold">{totalWagered}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Net Profit</div>
            <div className={`text-2xl font-bold flex items-center gap-1 ${netProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
              {netProfit >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
              {netProfit >= 0 ? "+" : ""}{netProfit}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Win Rate</div>
            <div className="text-2xl font-bold">
              {won.length + lost.length > 0
                ? `${Math.round((won.length / (won.length + lost.length)) * 100)}%`
                : "—"}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {won.length}W / {lost.length}L / {pending.length}P
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bet history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Bet History</CardTitle>
        </CardHeader>
        <CardContent>
          {bets.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No bets placed yet. Head to the Matches tab to wager your first Compute Tokens.
            </div>
          ) : (
            <div className="space-y-2">
              {bets.map((bet) => {
                const playerName = bet.side === "white" ? bet.match.white.name : bet.match.black.name;
                return (
                  <div
                    key={bet.id}
                    className="flex items-center gap-3 p-3 rounded border"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold">
                        {bet.amount} tokens on {playerName}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {bet.match.white.name} vs {bet.match.black.name} ·{" "}
                        {new Date(bet.createdAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                      </div>
                    </div>
                    <BetStatusBadge status={bet.status} payout={bet.payout} amount={bet.amount} />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground text-center pt-2">
        You receive <strong>1,000 free Compute Tokens daily</strong>. Tokens reset to 1,000 if your balance is below 1,000 when you return.
      </div>
    </div>
  );
}

function BetStatusBadge({ status, payout, amount }: { status: string; payout: number | null; amount: number }) {
  if (status === "WON") {
    const profit = (payout ?? 0) - amount;
    return (
      <Badge className="bg-green-600 text-white">
        <TrendingUp className="w-3 h-3 mr-1" />
        WON +{profit}
      </Badge>
    );
  }
  if (status === "LOST") {
    return (
      <Badge variant="secondary">
        <TrendingDown className="w-3 h-3 mr-1" />
        LOST -{amount}
      </Badge>
    );
  }
  if (status === "DRAWN") {
    return (
      <Badge variant="outline">
        <Minus className="w-3 h-3 mr-1" />
        REFUNDED
      </Badge>
    );
  }
  return <Badge variant="outline">PENDING</Badge>;
}
