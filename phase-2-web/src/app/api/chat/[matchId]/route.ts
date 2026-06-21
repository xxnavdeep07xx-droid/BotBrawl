/**
 * /api/chat/[matchId]
 *
 * GET  - list recent chat messages for a match (oldest first, last 100)
 * POST - post a new chat message. Body: { content }
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const DEMO_EMAIL = "demo@aichessgladiator.gg";

async function getDemoUser() {
  let user = await db.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!user) {
    user = await db.user.create({
      data: { email: DEMO_EMAIL, name: "Demo Spectator", computeTokens: 1000 },
    });
  }
  return user;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const { matchId } = await params;
  const messages = await db.chatMessage.findMany({
    where: { matchId },
    include: { user: true },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  return NextResponse.json({ messages });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ matchId: string }> }
) {
  try {
    const { matchId } = await params;
    const body = await req.json();
    const content: string = (body.content ?? "").toString().trim();
    if (!content) {
      return NextResponse.json(
        { error: "content is required" },
        { status: 400 }
      );
    }
    if (content.length > 500) {
      return NextResponse.json(
        { error: "content must be 500 chars or fewer" },
        { status: 400 }
      );
    }

    const match = await db.match.findUnique({ where: { id: matchId } });
    if (!match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    const user = await getDemoUser();
    const message = await db.chatMessage.create({
      data: {
        userId: user.id,
        matchId,
        content,
      },
      include: { user: true },
    });

    try {
      await fetch("http://localhost:3003/chat-emit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, message }),
      });
    } catch {}

    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
