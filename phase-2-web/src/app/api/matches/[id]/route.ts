/**
 * GET /api/matches/[id]
 * Returns the match with its events (chronological) and bets.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const match = await db.match.findUnique({
    where: { id },
    include: {
      white: true,
      black: true,
      events: { orderBy: { ply: "asc" } },
      bets: true,
    },
  });
  if (!match) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }
  return NextResponse.json({ match });
}
