/**
 * POST /api/tournaments/[id]/start
 * Flips an UPCOMING tournament to ACTIVE.
 */
import { NextRequest, NextResponse } from "next/server";
import { startTournament } from "@/lib/tournament";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const tournament = await startTournament(id);
    return NextResponse.json({ tournament });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 }
    );
  }
}
