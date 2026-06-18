"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Play, Sparkles, RefreshCw, Film, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { toast } from "sonner";

interface HighlightInfo {
  id: string;
  matchId: string;
  ply: number;
  side: "white" | "black";
  blunderType: string;
  blunderScore: number;
  title: string;
  monologue: string;
  san: string | null;
  status: "PENDING" | "RENDERING" | "RENDERED" | "FAILED";
  videoPath: string | null;
  createdAt: string;
  match: {
    id: string;
    white: { id: string; name: string; personaKey: string; elo: number };
    black: { id: string; name: string; personaKey: string; elo: number };
    winner: string | null;
  };
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

const BLUNDER_LABELS: Record<string, string> = {
  RESIGNATION: "Gave up",
  TIMEOUT: "Froze",
  ILLEGAL_RETRIES: "Illegal moves",
  ILLEGAL_ATTEMPT: "Illegal move",
  MATERIAL_LOSS: "Blundered material",
};

interface HighlightsViewProps {
  onViewMatch?: (matchId: string) => void;
}

export function HighlightsView({ onViewMatch }: HighlightsViewProps) {
  const qc = useQueryClient();
  const [detecting, setDetecting] = useState(false);
  const [rendering, setRendering] = useState<string | null>(null);

  const { data: highlights, isLoading } = useQuery<HighlightInfo[]>({
    queryKey: ["highlights"],
    queryFn: async () => {
      const r = await fetch("/api/highlights");
      const j = await r.json();
      return j.highlights;
    },
    refetchInterval: (query) => {
      // If any are RENDERING, poll faster
      const data = query.state.data;
      const anyRendering = data?.some((h) => h.status === "RENDERING");
      return anyRendering ? 2000 : 10_000;
    },
  });

  async function runDetection() {
    setDetecting(true);
    try {
      const r = await fetch("/api/highlights", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Detection failed");
      toast.success(j.detected.inserted > 0
        ? `Found ${j.detected.inserted} new blunder(s)! 🎉`
        : "No new blunders detected.");
      qc.invalidateQueries({ queryKey: ["highlights"] });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setDetecting(false);
    }
  }

  async function renderOne(hid: string) {
    setRendering(hid);
    try {
      const r = await fetch(`/api/highlights/${hid}/render`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Render failed to start");
      toast.success("Rendering started — should be ready in ~10 seconds.");
      qc.invalidateQueries({ queryKey: ["highlights"] });
    } catch (err) {
      toast.error((err as Error).message);
      setRendering(null);
    }
  }

  const all = highlights ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Film className="w-5 h-5" />
            Highlight Reel
          </h2>
          <p className="text-sm text-muted-foreground">
            Auto-detected AI blunders, rendered as 9:16 vertical clips for TikTok & YouTube Shorts.
          </p>
        </div>
        <Button onClick={runDetection} disabled={detecting}>
          {detecting ? (
            <>
              <Loader2 className="w-4 h-4 mr-1 animate-spin" /> Scanning...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 mr-1" /> Scan for Blunders
            </>
          )}
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Loading highlights...
        </div>
      )}

      {!isLoading && all.length === 0 && (
        <div className="text-center py-16 text-muted-foreground border border-dashed rounded-lg">
          <div className="text-4xl mb-3">🎬</div>
          <div className="font-semibold text-foreground">No highlights yet</div>
          <div className="text-sm mt-1 max-w-md mx-auto">
            Play some matches first, then click <strong>Scan for Blunders</strong> above.
            The detector will find the funniest AI fails and offer to render them as
            shareable vertical videos.
          </div>
        </div>
      )}

      {/* Highlight grid */}
      {all.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {all.map((h) => (
            <HighlightCard
              key={h.id}
              highlight={h}
              onViewMatch={onViewMatch}
              onRender={() => renderOne(h.id)}
              rendering={rendering === h.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single highlight card
// ---------------------------------------------------------------------------

function HighlightCard({
  highlight: h,
  onViewMatch,
  onRender,
  rendering,
}: {
  highlight: HighlightInfo;
  onViewMatch?: (matchId: string) => void;
  onRender: () => void;
  rendering: boolean;
}) {
  const playerName = h.side === "white" ? h.match.white.name : h.match.black.name;
  const personaKey = h.side === "white" ? h.match.white.personaKey : h.match.black.personaKey;
  const scoreColor =
    h.blunderScore >= 70 ? "bg-red-600"
    : h.blunderScore >= 40 ? "bg-orange-500"
    : "bg-yellow-500";

  return (
    <Card className="overflow-hidden flex flex-col">
      {/* Video / thumbnail area (9:16 ratio, max height) */}
      <div className="relative aspect-[9/16] bg-zinc-950 max-h-72 mx-auto w-full">
        {h.status === "RENDERED" && h.videoPath ? (
          <video
            src={`/${h.videoPath}`}
            controls
            loop
            className="w-full h-full object-cover"
            preload="metadata"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-500">
            {h.status === "RENDERING" || rendering ? (
              <div className="text-center">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
                <div className="text-xs">Rendering...</div>
              </div>
            ) : h.status === "FAILED" ? (
              <div className="text-center">
                <AlertCircle className="w-8 h-8 mx-auto mb-2 text-red-500" />
                <div className="text-xs">Render failed</div>
              </div>
            ) : (
              <div className="text-center">
                <Film className="w-8 h-8 mx-auto mb-2" />
                <div className="text-xs">Not yet rendered</div>
              </div>
            )}
          </div>
        )}

        {/* Score badge overlay */}
        <div className={`absolute top-2 right-2 ${scoreColor} text-white px-2 py-0.5 rounded-full text-xs font-bold shadow-lg`}>
          FAIL {h.blunderScore}
        </div>

        {/* Blunder type badge */}
        <div className="absolute top-2 left-2 bg-black/60 text-white px-2 py-0.5 rounded-full text-[10px] font-semibold backdrop-blur">
          {BLUNDER_LABELS[h.blunderType] ?? h.blunderType}
        </div>
      </div>

      <CardContent className="p-3 flex-1 flex flex-col gap-2">
        {/* Title */}
        <h3 className="font-bold text-sm leading-snug line-clamp-2">{h.title}</h3>

        {/* Player + persona */}
        <div className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{playerName}</span> · {PERSONA_LABELS[personaKey] ?? personaKey}
        </div>

        {/* Monologue */}
        <div className="text-xs italic text-muted-foreground line-clamp-3 border-l-2 pl-2 border-zinc-300 dark:border-zinc-700">
          &ldquo;{h.monologue}&rdquo;
        </div>

        {/* Footer: actions */}
        <div className="flex items-center justify-between mt-auto pt-2 gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="text-xs h-7 px-2"
            onClick={() => onViewMatch?.(h.matchId)}
          >
            View match →
          </Button>
          {h.status !== "RENDERED" && (
            <Button
              size="sm"
              onClick={onRender}
              disabled={h.status === "RENDERING" || rendering}
              className="h-7"
            >
              {h.status === "RENDERING" || rendering ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" /> Rendering
                </>
              ) : (
                <>
                  <Play className="w-3 h-3 mr-1" /> Render
                </>
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
