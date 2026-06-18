/**
 * /api/bets
 *
 * GET  — list the current user's bets (already returned by /api/user, but
 *        keep this for completeness / future pagination).
 * POST — place a new bet on an upcoming match.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { payoutMultiplier } from "@/lib/elo";

export const dynamic = "force-dynamic";

const DEMO_EMAIL = "demo@aichessgladiator.gg";

export async function GET() {
  const user = await db.user.findUnique({
    where: { email: DEMO_EMAIL },
    include: {
      bets: {
        include: { match: { include: { white: true, black: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!user) {
    return NextResponse.json({ bets: [] });
  }
  return NextResponse.json({ bets: user.bets });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { matchId, side, amount } = body;
    if (!matchId || !side || !amount) {
      return NextResponse.json(
        { error: "matchId, side, and amount are required" },
        { status: 400 }
      );
    }
    if (side !== "white" && side !== "black") {
      return NextResponse.json(
        { error: "side must be 'white' or 'black'" },
        { status: 400 }
      );
    }
    const amt = Math.floor(Number(amount));
    if (!Number.isFinite(amt) || amt <= 0) {
      return NextResponse.json(
        { error: "amount must be a positive integer" },
        { status: 400 }
      );
    }

    const [user, match] = await Promise.all([
      db.user.findUnique({ where: { email: DEMO_EMAIL } }),
      db.match.findUnique({
        where: { id: matchId },
        include: { white: true, black: true },
      }),
    ]);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (!match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }
    if (match.status !== "UPCOMING") {
      return NextResponse.json(
        { error: `Cannot bet on a match with status ${match.status}` },
        { status: 400 }
      );
    }
    if (user.computeTokens < amt) {
      return NextResponse.json(
        {
          error: `Insufficient tokens. You have ${user.computeTokens}, tried to bet ${amt}.`,
        },
        { status: 400 }
      );
    }

    // Deduct + create bet atomically.
    const [updatedUser, bet] = await db.$transaction([
      db.user.update({
        where: { id: user.id },
        data: { computeTokens: { decrement: amt } },
      }),
      db.bet.create({
        data: {
          userId: user.id,
          matchId,
          side,
          amount: amt,
        },
      }),
    ]);

    const mult = payoutMultiplier(
      match.white.elo,
      match.black.elo,
      side
    );
    const potentialPayout = Math.round(amt * mult);

    return NextResponse.json({
      bet,
      user: updatedUser,
      potentialPayout,
      multiplier: mult,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
