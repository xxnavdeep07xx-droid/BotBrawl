"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { MatchCard, MatchInfo } from "@/components/match-card";
import { CreateMatchDialog } from "@/components/create-match-dialog";

interface UpcomingViewProps {
  onViewMatch: (matchId: string) => void;
  onStartMatch?: (matchId: string) => void;
  canStart?: boolean;
}

export function UpcomingView({ onViewMatch, onStartMatch, canStart }: UpcomingViewProps) {
  const qc = useQueryClient();

  const { data: matches, isLoading } = useQuery<MatchInfo[]>({
    queryKey: ["matches"],
    queryFn: async () => {
      const r = await fetch("/api/matches");
      const j = await r.json();
      return j.matches;
    },
    refetchInterval: 3000,
  });

  // Split by status.
  const all = matches ?? [];
  const live = all.filter((m) => m.status === "LIVE");
  const upcoming = all.filter((m) => m.status === "UPCOMING");
  const completed = all.filter((m) => m.status === "COMPLETED").slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Matches</h2>
          <p className="text-sm text-muted-foreground">
            Schedule new AI matchups, place bets, and watch the carnage unfold.
          </p>
        </div>
        <CreateMatchDialog onCreated={(mid) => {
          qc.invalidateQueries({ queryKey: ["matches"] });
          onViewMatch(mid);
        }} />
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading matches...
        </div>
      )}

      {!isLoading && all.length === 0 && (
        <div className="text-center py-16 text-muted-foreground border border-dashed rounded-lg">
          <div className="text-4xl mb-3">♟️</div>
          <div className="font-semibold text-foreground">No matches yet</div>
          <div className="text-sm mt-1">
            Click <strong>Schedule Match</strong> above to set up your first AI duel.
          </div>
        </div>
      )}

      {live.length > 0 && (
        <Section title="🔴 Live Now" matches={live} onViewMatch={onViewMatch} onStartMatch={onStartMatch} canStart={canStart} />
      )}

      {upcoming.length > 0 && (
        <Section title="📅 Upcoming" matches={upcoming} onViewMatch={onViewMatch} onStartMatch={onStartMatch} canStart={canStart} />
      )}

      {completed.length > 0 && (
        <Section title="🏆 Recent Results" matches={completed} onViewMatch={onViewMatch} onStartMatch={onStartMatch} canStart={canStart} />
      )}
    </div>
  );
}

function Section({
  title,
  matches,
  onViewMatch,
  onStartMatch,
  canStart,
}: {
  title: string;
  matches: MatchInfo[];
  onViewMatch: (matchId: string) => void;
  onStartMatch?: (matchId: string) => void;
  canStart?: boolean;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-muted-foreground mb-3">{title}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {matches.map((m) => (
          <MatchCard
            key={m.id}
            match={m}
            onView={onViewMatch}
            onStart={onStartMatch}
            canStart={canStart}
          />
        ))}
      </div>
    </div>
  );
}
