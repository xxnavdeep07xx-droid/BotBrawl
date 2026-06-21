/**
 * GET /api/tournaments/[id]
 * Returns the tournament with full bracket structure for visualization.
 */
import { NextRequest, NextResponse } from "next/server";
import { getBracketView } from "@/lib/tournament";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const bracket = await getBracketView(id);
    return NextResponse.json({ bracket });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 404 }
    );
  }
}
