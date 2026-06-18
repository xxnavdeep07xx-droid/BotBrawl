/**
 * POST /api/highlights/[id]/render
 *
 * Triggers Python rendering for one highlight. Fire-and-forget —
 * the Python script updates the DB row directly when done.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { execRender } from "@/lib/clipping-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const highlight = await db.highlight.findUnique({ where: { id } });
  if (!highlight) {
    return NextResponse.json({ error: "Highlight not found" }, { status: 404 });
  }

  // Mark as rendering immediately so the UI shows progress.
  await db.highlight.update({
    where: { id },
    data: { status: "RENDERING" },
  });

  // Fire the Python renderer in the background. We DON'T await it because
  // rendering can take ~10s per clip and we don't want to hold the request.
  execRender(id)
    .then(async () => {
      // The Python script sets status=RENDERED + videoPath itself, but in case
      // it didn't (e.g. crashed), refresh by reading the DB.
      const fresh = await db.highlight.findUnique({ where: { id } });
      if (fresh && fresh.status === "RENDERING") {
        await db.highlight.update({
          where: { id },
          data: { status: "FAILED" },
        });
      }
    })
    .catch(async (err) => {
      console.error(`[render ${id}] failed:`, err);
      await db.highlight.update({
        where: { id },
        data: { status: "FAILED" },
      });
    });

  return NextResponse.json({ ok: true, id, status: "RENDERING" });
}
