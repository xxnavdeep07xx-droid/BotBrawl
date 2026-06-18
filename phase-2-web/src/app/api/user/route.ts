/**
 * GET /api/user
 * Returns the current demo user + token balance.
 *
 * Phase 2 simplification: there's one canonical demo user (created on
 * first request). Auth lands in Phase 3.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const DEMO_EMAIL = "demo@aichessgladiator.gg";
const DEMO_NAME = "Demo Spectator";

export async function GET() {
  let user = await db.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!user) {
    user = await db.user.create({
      data: { email: DEMO_EMAIL, name: DEMO_NAME, computeTokens: 1000 },
    });
  }

  // Daily token grant — if last grant was >24h ago, top up to 1000.
  const now = new Date();
  const oneDayMs = 24 * 60 * 60 * 1000;
  if (now.getTime() - user.lastTokenGrant.getTime() > oneDayMs) {
    const granted = Math.max(0, 1000 - user.computeTokens);
    user = await db.user.update({
      where: { id: user.id },
      data: {
        computeTokens: 1000,
        lastTokenGrant: now,
      },
    });
    // Mark the grant so the client can show a toast. We won't bother for
    // Phase 2 — the balance just refreshes.
    void granted;
  }

  const bets = await db.bet.findMany({
    where: { userId: user.id },
    include: { match: { include: { white: true, black: true } } },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  return NextResponse.json({ user, bets });
}
