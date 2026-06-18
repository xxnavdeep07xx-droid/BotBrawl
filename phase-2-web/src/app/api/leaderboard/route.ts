/**
 * GET /api/leaderboard
 * Returns all AI players sorted by Elo descending.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const players = await db.aIPlayer.findMany({
    orderBy: { elo: "desc" },
  });
  return NextResponse.json({ players });
}
