/**
 * /api/matches
 *
 * GET  — list matches (filter by ?status=UPCOMING|LIVE|COMPLETED), newest first.
 * POST — create a new upcoming match between two AI players.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status");
  const where = status ? { status } : {};
  const matches = await db.match.findMany({
    where,
    include: {
      white: true,
      black: true,
      bets: true,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ matches });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { whiteId, blackId } = body;
    if (!whiteId || !blackId) {
      return NextResponse.json(
        { error: "whiteId and blackId are required" },
        { status: 400 }
      );
    }
    if (whiteId === blackId) {
      return NextResponse.json(
        { error: "White and black must be different players" },
        { status: 400 }
      );
    }
    const [white, black] = await Promise.all([
      db.aIPlayer.findUnique({ where: { id: whiteId } }),
      db.aIPlayer.findUnique({ where: { id: blackId } }),
    ]);
    if (!white || !black) {
      return NextResponse.json(
        { error: "One or both players not found" },
        { status: 404 }
      );
    }
    const match = await db.match.create({
      data: {
        whiteId,
        blackId,
        status: "UPCOMING",
      },
      include: { white: true, black: true },
    });
    return NextResponse.json({ match }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
