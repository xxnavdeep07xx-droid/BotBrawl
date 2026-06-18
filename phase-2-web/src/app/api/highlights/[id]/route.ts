/**
 * GET /api/highlights/[id]
 * Returns one highlight with its source match.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const highlight = await db.highlight.findUnique({
    where: { id },
    include: { match: { include: { white: true, black: true } } },
  });
  if (!highlight) {
    return NextResponse.json({ error: "Highlight not found" }, { status: 404 });
  }
  return NextResponse.json({ highlight });
}
