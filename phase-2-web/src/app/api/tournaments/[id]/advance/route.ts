/**
 * POST /api/tournaments/[id]/advance
 *
 * Body: { tournamentMatchId }
 *
 * Schedules the next READY match in the tournament (creates a Match row,
 * marks TournamentMatch as LIVE). If a tournamentMatchId is supplied AND its
 * linked Match is COMPLETED, first advances the bracket (moves winner to
 * next round, marks slots eliminated, possibly completes tournament).
 *
 * Returns the new Match to start, or null if no READY match.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { advanceTournament, scheduleTournamentMatch } from "@/lib/tournament";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tournamentId } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const completedTmId: string | undefined = body.tournamentMatchId;

    // 1) If a tournamentMatchId was supplied, advance the bracket past it
    if (completedTmId) {
      await advanceTournament(completedTmId);
    }

    // 2) Find the next READY match in the tournament
    const nextReady = await db.tournamentMatch.findFirst({
      where: { tournamentId, status: "READY" },
      orderBy: [{ round: "asc" }, { bracketIndex: "asc" }],
    });

    if (!nextReady) {
      // Check if the tournament is complete
      const tournament = await db.tournament.findUnique({
        where: { id: tournamentId },
      });
      if (tournament?.status === "COMPLETED") {
        return NextResponse.json({
          ok: true,
          tournamentComplete: true,
          winnerId: tournament.winnerId,
          nextMatch: null,
        });
      }
      return NextResponse.json({
        ok: true,
        tournamentComplete: false,
        nextMatch: null,
        message: "No READY matches — waiting for current round to complete.",
      });
    }

    // 3) Schedule it (creates the Match row)
    const match = await scheduleTournamentMatch(nextReady.id);

    return NextResponse.json({
      ok: true,
      tournamentComplete: false,
      nextMatch: match,
      tournamentMatchId: nextReady.id,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
