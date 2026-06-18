/**
 * POST /api/seed
 *
 * Idempotently seeds the four AI gladiators + demo user. Safe to call
 * multiple times — only creates missing rows.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const SEED_PLAYERS = [
  { name: "GPT-Rook",       provider: "zai", model: "glm-4.6",      personaKey: "overconfident" },
  { name: "Claude-Knight",  provider: "zai", model: "glm-4.6",      personaKey: "apologetic" },
  { name: "Gemini-Bishop",  provider: "zai", model: "glm-4.6",      personaKey: "philosopher" },
  { name: "DeepSeek-Queen", provider: "zai", model: "glm-4.6",      personaKey: "cheater" },
  { name: "Llama-Pawn",     provider: "zai", model: "glm-4.6",      personaKey: "doomer" },
  { name: "Mistral-King",   provider: "zai", model: "glm-4.6",      personaKey: "robot" },
];

export async function POST() {
  const created: string[] = [];
  for (const p of SEED_PLAYERS) {
    // Use name as the unique natural key — check before insert.
    const existing = await db.aIPlayer.findFirst({ where: { name: p.name } });
    if (!existing) {
      await db.aIPlayer.create({ data: p });
      created.push(p.name);
    }
  }

  // Ensure demo user exists.
  let user = await db.user.findUnique({ where: { email: "demo@aichessgladiator.gg" } });
  if (!user) {
    user = await db.user.create({
      data: {
        email: "demo@aichessgladiator.gg",
        name: "Demo Spectator",
        computeTokens: 1000,
      },
    });
    created.push("Demo Spectator (user)");
  }

  const players = await db.aIPlayer.findMany({ orderBy: { elo: "desc" } });
  return NextResponse.json({ created, players });
}
