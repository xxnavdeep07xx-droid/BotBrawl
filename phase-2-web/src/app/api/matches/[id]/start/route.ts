/**
 * POST /api/matches/[id]/start
 *
 * Marks the match as LIVE and kicks off the async runner. The runner
 * itself lives in the socket.io mini-service on port 3003 — this endpoint
 * just signals it to start by emitting a "start_match" event over a
 * shared in-memory channel (the mini-service polls a small SQLite-backed
 * queue, simpler than IPC for a Phase 2 demo).
 *
 * For Phase 2 we use a lightweight approach: set status=LIVE, then call
 * the runner directly here in a fire-and-forget Promise. The runner emits
 * events to socket.io via HTTP POST to the mini-service.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getPersona } from "@/lib/personas";
import { runMatch, DEFAULT_MATCH_CONFIG, MatchEvent } from "@/lib/chess-engine";
import { updateElo } from "@/lib/elo";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes — Vercel-safe; we run longer locally

async function emitToSocketService(matchId: string, event: MatchEvent) {
  // Best-effort fan-out to the mini-service so connected clients see the
  // event in real time. Failure is non-fatal — the DB is the source of truth.
  try {
    await fetch("http://localhost:3003/emit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matchId, event }),
    });
  } catch {
    // Mini-service may not be up in all environments — swallow the error.
  }
}

async function persistEvent(matchId: string, e: MatchEvent) {
  try {
    await db.matchEvent.create({
      data: {
        matchId,
        ply: e.ply,
        side: e.side,
        type: e.type,
        san: e.san ?? null,
        monologue: e.monologue ?? null,
        retries: e.retries ?? 0,
        apiErrors: e.apiErrors ?? 0,
        elapsedMs: e.elapsedMs ?? 0,
      },
    });
  } catch (err) {
    console.error("[persistEvent] failed:", err);
  }
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const match = await db.match.findUnique({
    where: { id },
    include: { white: true, black: true },
  });
  if (!match) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }
  if (match.status === "LIVE") {
    return NextResponse.json({ error: "Match is already live" }, { status: 409 });
  }
  if (match.status === "COMPLETED") {
    return NextResponse.json({ error: "Match already completed" }, { status: 409 });
  }

  // Flip to LIVE.
  await db.match.update({
    where: { id },
    data: { status: "LIVE", startedAt: new Date() },
  });

  // Build player configs.
  const whitePersona = getPersona(match.white.personaKey);
  const blackPersona = getPersona(match.black.personaKey);

  // Fire-and-forget the runner. We do NOT await — this endpoint must return
  // immediately so the client can switch to live-view mode.
  (async () => {
    try {
      const result = await runMatch(
        { persona: whitePersona, side: "white", maxRetries: 3 },
        { persona: blackPersona, side: "black", maxRetries: 3 },
        DEFAULT_MATCH_CONFIG,
        async (e) => {
          await persistEvent(id, e);
          await emitToSocketService(id, e);
        }
      );

      // Settle the match.
      const scoreWhite: 0 | 0.5 | 1 =
        result.winner === "white" ? 1 : result.winner === "black" ? 0 : 0.5;

      const [newEloWhite, newEloBlack] = updateElo(
        match.white.elo,
        match.black.elo,
        scoreWhite
      );

      await db.$transaction([
        db.match.update({
          where: { id },
          data: {
            status: "COMPLETED",
            winner: result.winner,
            reason: result.reason,
            finalFen: result.finalFen,
            pgn: result.pgn,
            plies: result.plies,
            completedAt: new Date(),
          },
        }),
        db.aIPlayer.update({
          where: { id: match.whiteId },
          data: {
            elo: newEloWhite,
            wins: { increment: result.winner === "white" ? 1 : 0 },
            losses: { increment: result.winner === "black" ? 1 : 0 },
            draws: { increment: result.winner === null ? 1 : 0 },
          },
        }),
        db.aIPlayer.update({
          where: { id: match.blackId },
          data: {
            elo: newEloBlack,
            wins: { increment: result.winner === "black" ? 1 : 0 },
            losses: { increment: result.winner === "white" ? 1 : 0 },
            draws: { increment: result.winner === null ? 1 : 0 },
          },
        }),
      ]);

      // Settle bets.
      const bets = await db.bet.findMany({ where: { matchId: id, status: "PENDING" } });
      for (const bet of bets) {
        if (result.winner === null) {
          // Draw — refund.
          await db.bet.update({
            where: { id: bet.id },
            data: { status: "DRAWN", payout: bet.amount },
          });
          await db.user.update({
            where: { id: bet.userId },
            data: { computeTokens: { increment: bet.amount } },
          });
        } else if (bet.side === result.winner) {
          // Won — pay out.
          const { payoutMultiplier } = await import("@/lib/elo");
          const mult = payoutMultiplier(match.white.elo, match.black.elo, bet.side);
          const payout = Math.round(bet.amount * mult);
          await db.bet.update({
            where: { id: bet.id },
            data: { status: "WON", payout },
          });
          await db.user.update({
            where: { id: bet.userId },
            data: { computeTokens: { increment: payout } },
          });
        } else {
          // Lost.
          await db.bet.update({
            where: { id: bet.id },
            data: { status: "LOST", payout: 0 },
          });
        }
      }

      // Emit final event so clients close out cleanly.
      await emitToSocketService(id, {
        type: "match_end",
        ply: result.plies,
        side: "",
        timestamp: Date.now(),
        extra: { winner: result.winner, reason: result.reason, durationMs: result.durationMs },
      });
    } catch (err) {
      console.error("[start_match] runner crashed:", err);
      await db.match.update({
        where: { id },
        data: {
          status: "COMPLETED",
          winner: null,
          reason: `Internal error: ${(err as Error).message}`,
          completedAt: new Date(),
        },
      });
    }
  })();

  return NextResponse.json({ ok: true, matchId: id, status: "LIVE" });
}
