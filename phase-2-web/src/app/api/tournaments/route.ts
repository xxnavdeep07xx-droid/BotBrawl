/**
 * /api/tournaments
 *
 * GET  — list all tournaments, newest first
 * POST — create a new tournament. Body: { name, size, playerIds }
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createTournament } from "@/lib/tournament";

export const dynamic = "force-dynamic";

export async function GET() {
  const tournaments = await db.tournament.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { matches: true } },
    },
    take: 50,
  });
  return NextResponse.json({ tournaments });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, size, playerIds } = body;
    if (!name || !size || !playerIds) {
      return NextResponse.json(
        { error: "name, size, and playerIds are required" },
        { status: 400 }
      );
    }
    if (size !== 4 && size !== 8) {
      return NextResponse.json(
        { error: "size must be 4 or 8" },
        { status: 400 }
      );
    }
    if (!Array.isArray(playerIds) || playerIds.length !== size) {
      return NextResponse.json(
        { error: `playerIds must be an array of length ${size}` },
        { status: 400 }
      );
    }
    const tournament = await createTournament({ name, size, playerIds });
    return NextResponse.json({ tournament }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
