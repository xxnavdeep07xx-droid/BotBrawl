/**
 * /api/highlights
 *
 * GET  — list highlights (optionally filter by ?matchId= or ?status=)
 * POST — trigger blunder detection on a specific match (shells out to Python)
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { execDetected, execRender } from "@/lib/clipping-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const matchId = req.nextUrl.searchParams.get("matchId");
  const status = req.nextUrl.searchParams.get("status");

  const where: Record<string, string> = {};
  if (matchId) where.matchId = matchId;
  if (status) where.status = status;

  const highlights = await db.highlight.findMany({
    where,
    include: {
      match: {
        include: { white: true, black: true },
      },
    },
    orderBy: { blunderScore: "desc" },
    take: 100,
  });

  return NextResponse.json({ highlights });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const matchId: string | undefined = body.matchId;

    // Run the Python detector
    const result = await execDetected(matchId);

    // Re-fetch the highlights for this match (or all if no matchId)
    const where = matchId ? { matchId } : {};
    const highlights = await db.highlight.findMany({
      where,
      include: { match: { include: { white: true, black: true } } },
      orderBy: { blunderScore: "desc" },
    });

    return NextResponse.json({
      ok: true,
      detected: result,
      highlights,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
