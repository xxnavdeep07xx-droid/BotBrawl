/**
 * Tournament library — bracket generation, match scheduling, and
 * auto-advance logic for single-elimination tournaments.
 *
 * Bracket structure (single-elim, size N = power of 2):
 *
 *   Round 0 (Round of N):     N/2 matches
 *   Round 1 (Quarterfinals):  N/4 matches  (or Semifinals if N=4)
 *   ...
 *   Round log2(N)-1 (Finals): 1 match
 *
 * Seeding (standard "snake" seeding so the top two seeds can only meet in
 * the final):
 *
 *   For N=4:  seeds 1,4,2,3  →  matches (1v4), (2v3)
 *   For N=8:  seeds 1,8,5,4,3,6,7,2  →  matches (1v8), (5v4), (3v6), (7v2)
 *
 * The "snake" pattern is: seed S in slot i, where i is computed by recursively
 * splitting the bracket.
 */

import { db } from "./db";

// ---------------------------------------------------------------------------
// Seed ordering — standard tournament seeding so the highest seeds can't
// meet until the latest possible round.
// ---------------------------------------------------------------------------

/**
 * Generate the seed order for a single-elim bracket of size N.
 * Returns an array of seeds (1-indexed) in bracket-slot order.
 *
 * For N=4:  [1, 4, 2, 3]    → match 0 is seeds 1v4, match 1 is seeds 2v3
 * For N=8:  [1, 8, 5, 4, 3, 6, 7, 2]
 *
 * The algorithm: recursively, the seeds for round 0 of an N-bracket are
 * [1, N, ...seeds(N/2) shifted by N/2-1 interleaved]. Easier: build it
 * iteratively by re-seeding at each round.
 */
export function seedOrder(size: number): number[] {
  if (size < 2 || !Number.isInteger(Math.log2(size))) {
    throw new Error(`Tournament size must be a power of 2 >= 2, got ${size}`);
  }
  // Build round by round. Round 0 of a 2-bracket is [1, 2].
  // To go from size N to size 2N: each old seed s becomes (s, 2N+1-s).
  let order = [1, 2];
  let current = 2;
  while (current < size) {
    const next: number[] = [];
    const doubled = current * 2;
    for (const s of order) {
      next.push(s);
      next.push(doubled + 1 - s);
    }
    order = next;
    current = doubled;
  }
  return order;
}

/**
 * Total rounds in a single-elim tournament of size N. log2(N).
 */
export function totalRounds(size: number): number {
  return Math.log2(size);
}

/**
 * Number of matches in a given round (0-indexed).
 * Round 0 has N/2 matches, round 1 has N/4, etc.
 */
export function matchesInRound(size: number, round: number): number {
  return size / Math.pow(2, round + 1);
}

// ---------------------------------------------------------------------------
// Tournament creation — generate all TournamentMatch rows for every round,
// with round 0 populated with seeds. Later rounds are PENDING until their
// dependents complete.
// ---------------------------------------------------------------------------

export interface CreateTournamentInput {
  name: string;
  size: 4 | 8;
  playerIds: string[]; // must be length === size, ordered by Elo desc (or any order)
}

export async function createTournament(input: CreateTournamentInput) {
  if (input.playerIds.length !== input.size) {
    throw new Error(
      `Tournament size ${input.size} requires ${input.size} players, got ${input.playerIds.length}`
    );
  }

  // Fetch the AI players to validate they exist
  const players = await db.aIPlayer.findMany({
    where: { id: { in: input.playerIds } },
  });
  if (players.length !== input.size) {
    throw new Error(
      `Only ${players.length}/${input.size} players found in DB`
    );
  }

  // Sort by Elo desc (highest Elo = seed 1)
  const sortedPlayerIds = [...input.playerIds].sort((a, b) => {
    const pa = players.find((p) => p.id === a)!;
    const pb = players.find((p) => p.id === b)!;
    return pb.elo - pa.elo;
  });

  // Apply seed ordering
  const seeds = seedOrder(input.size);
  // seeds[i] is the seed (1-indexed) for bracket slot i
  // We want slot i to be filled by sortedPlayerIds[seeds[i] - 1]
  const slotsBySeed = sortedPlayerIds; // index 0 = seed 1, index 1 = seed 2, ...

  return await db.$transaction(async (tx) => {
    // Create the tournament
    const tournament = await tx.tournament.create({
      data: {
        name: input.name,
        format: "SINGLE_ELIM",
        size: input.size,
        status: "UPCOMING",
      },
    });

    // Create the slots
    const slotMap: Record<number, string> = {}; // seed → slotId
    for (let i = 0; i < input.size; i++) {
      const seedNumber = i + 1;
      const playerId = slotsBySeed[i];
      const slot = await tx.tournamentSlot.create({
        data: {
          tournamentId: tournament.id,
          seed: seedNumber,
          playerId,
        },
      });
      slotMap[seedNumber] = slot.id;
    }

    // Create all TournamentMatch rows for all rounds.
    // Round 0 gets white/black slots assigned; later rounds stay null.
    const rounds = totalRounds(input.size);
    for (let round = 0; round < rounds; round++) {
      const matchCount = matchesInRound(input.size, round);
      for (let idx = 0; idx < matchCount; idx++) {
        let whiteSlotId: string | null = null;
        let blackSlotId: string | null = null;

        if (round === 0) {
          // For round 0: match idx corresponds to slots 2*idx and 2*idx+1
          // in bracket order. The seed at slot 2*idx is seeds[2*idx],
          // at slot 2*idx+1 is seeds[2*idx+1].
          const seedA = seeds[2 * idx];
          const seedB = seeds[2 * idx + 1];
          // White = higher seed (lower number)
          whiteSlotId = slotMap[Math.min(seedA, seedB)];
          blackSlotId = slotMap[Math.max(seedA, seedB)];
        }

        await tx.tournamentMatch.create({
          data: {
            tournamentId: tournament.id,
            round,
            bracketIndex: idx,
            whiteSlotId,
            blackSlotId,
            status: round === 0 ? "READY" : "PENDING",
          },
        });
      }
    }

    return tournament;
  });
}

// ---------------------------------------------------------------------------
// Start a tournament — flip to ACTIVE, set currentRound=0
// ---------------------------------------------------------------------------

export async function startTournament(tournamentId: string) {
  const tournament = await db.tournament.findUnique({
    where: { id: tournamentId },
    include: { matches: true },
  });
  if (!tournament) throw new Error("Tournament not found");
  if (tournament.status !== "UPCOMING")
    throw new Error(`Tournament is ${tournament.status}, cannot start`);

  return await db.tournament.update({
    where: { id: tournamentId },
    data: {
      status: "ACTIVE",
      currentRound: 0,
      startedAt: new Date(),
    },
  });
}

// ---------------------------------------------------------------------------
// Schedule a tournament match — creates a Match row linked to the
// TournamentMatch, and returns it so the caller can start it.
// ---------------------------------------------------------------------------

export async function scheduleTournamentMatch(tournamentMatchId: string) {
  const tm = await db.tournamentMatch.findUnique({
    where: { id: tournamentMatchId },
    include: {
      whiteSlot: true,
      blackSlot: true,
      tournament: true,
    },
  });
  if (!tm) throw new Error("TournamentMatch not found");
  if (tm.status !== "READY")
    throw new Error(`TournamentMatch is ${tm.status}, must be READY`);
  if (!tm.whiteSlot || !tm.blackSlot)
    throw new Error("TournamentMatch is missing players");

  // Create the actual Match (UPCOMING, ready to start)
  const match = await db.match.create({
    data: {
      whiteId: tm.whiteSlot.playerId,
      blackId: tm.blackSlot.playerId,
      status: "UPCOMING",
    },
  });

  await db.tournamentMatch.update({
    where: { id: tournamentMatchId },
    data: {
      matchId: match.id,
      status: "LIVE",
    },
  });

  return match;
}

// ---------------------------------------------------------------------------
// Advance a tournament after a match completes — mark the
// TournamentMatch COMPLETED, advance the winner to the next round, and if
// the round is complete, bump currentRound (or mark the tournament COMPLETED
// if it was the final).
// ---------------------------------------------------------------------------

export async function advanceTournament(tournamentMatchId: string) {
  const tm = await db.tournamentMatch.findUnique({
    where: { id: tournamentMatchId },
    include: { tournament: true, match: true },
  });
  if (!tm) throw new Error("TournamentMatch not found");
  if (tm.status !== "LIVE") return; // nothing to do
  if (!tm.match) throw new Error("TournamentMatch has no linked Match");
  if (tm.match.status !== "COMPLETED")
    throw new Error(`Linked Match is ${tm.match.status}, must be COMPLETED`);

  const winnerSide = tm.match.winner; // "white" | "black" | null
  let winnerSlotId: string | null = null;
  if (winnerSide === "white") winnerSlotId = tm.whiteSlotId;
  else if (winnerSide === "black") winnerSlotId = tm.blackSlotId;

  // If draw, pick the higher seed (white = higher seed by our convention)
  if (!winnerSlotId) winnerSlotId = tm.whiteSlotId;

  // Mark this TournamentMatch as COMPLETED
  await db.tournamentMatch.update({
    where: { id: tournamentMatchId },
    data: {
      status: "COMPLETED",
      winnerSlotId,
    },
  });

  // Mark the loser's slot as eliminated
  const loserSlotId =
    winnerSlotId === tm.whiteSlotId ? tm.blackSlotId : tm.whiteSlotId;
  if (loserSlotId) {
    await db.tournamentSlot.update({
      where: { id: loserSlotId },
      data: { eliminated: true, eliminatedIn: tm.round },
    });
  }

  // Advance the winner to the next round if there is one
  const totalRds = totalRounds(tm.tournament.size);
  if (tm.round + 1 < totalRds) {
    const nextRound = tm.round + 1;
    const nextBracketIndex = Math.floor(tm.bracketIndex / 2);
    const nextMatch = await db.tournamentMatch.findUnique({
      where: {
        tournamentId_round_bracketIndex: {
          tournamentId: tm.tournamentId,
          round: nextRound,
          bracketIndex: nextBracketIndex,
        },
      },
    });
    if (!nextMatch)
      throw new Error(
        `Next-round match not found: round ${nextRound} idx ${nextBracketIndex}`
      );

    // Winner goes to white if they're in the lower bracketIndex half,
    // black if in the upper half (so two winners feed in correctly)
    const isLowerHalf = tm.bracketIndex % 2 === 0;
    const updateData: Record<string, string | null> = isLowerHalf
      ? { whiteSlotId: winnerSlotId }
      : { blackSlotId: winnerSlotId };
    await db.tournamentMatch.update({
      where: { id: nextMatch.id },
      data: updateData,
    });

    // If both slots are now filled, mark READY
    const refreshed = await db.tournamentMatch.findUnique({
      where: { id: nextMatch.id },
    });
    if (refreshed && refreshed.whiteSlotId && refreshed.blackSlotId) {
      await db.tournamentMatch.update({
        where: { id: nextMatch.id },
        data: { status: "READY" },
      });
    }
  } else {
    // This was the final — mark the tournament COMPLETED
    const winnerSlot = await db.tournamentSlot.findUnique({
      where: { id: winnerSlotId! },
    });
    await db.tournament.update({
      where: { id: tm.tournamentId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        winnerId: winnerSlot?.playerId,
      },
    });
    return { tournamentComplete: true, winnerPlayerId: winnerSlot?.playerId };
  }

  // Check if the current round is fully complete; if so, bump currentRound
  const currentRoundMatches = await db.tournamentMatch.findMany({
    where: { tournamentId: tm.tournamentId, round: tm.round },
  });
  const allComplete = currentRoundMatches.every(
    (m) => m.status === "COMPLETED"
  );
  if (allComplete) {
    await db.tournament.update({
      where: { id: tm.tournamentId },
      data: { currentRound: tm.round + 1 },
    });
  }

  return { tournamentComplete: false, advancedToRound: tm.round + 1 };
}

// ---------------------------------------------------------------------------
// Helpers for the UI
// ---------------------------------------------------------------------------

export interface BracketView {
  tournament: {
    id: string;
    name: string;
    size: number;
    status: string;
    currentRound: number;
    winnerId: string | null;
  };
  rounds: {
    round: number;
    label: string;
    matches: {
      id: string;
      bracketIndex: number;
      status: string;
      matchId: string | null;
      matchStatus: string | null;
      matchWinner: string | null;
      whiteSlot: {
        seed: number;
        playerName: string;
        playerElo: number;
        winner: boolean;
      } | null;
      blackSlot: {
        seed: number;
        playerName: string;
        playerElo: number;
        winner: boolean;
      } | null;
    }[];
  }[];
}

export async function getBracketView(tournamentId: string): Promise<BracketView> {
  const tournament = await db.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      matches: {
        orderBy: [{ round: "asc" }, { bracketIndex: "asc" }],
        include: {
          match: true,
          whiteSlot: { include: { player: true } },
          blackSlot: { include: { player: true } },
        },
      },
    },
  });
  if (!tournament) throw new Error("Tournament not found");

  const rounds = totalRounds(tournament.size);
  const roundLabels = roundLabelsFor(rounds);

  const roundsData = Array.from({ length: rounds }, (_, r) => {
    const matchesInThisRound = tournament.matches.filter((m) => m.round === r);
    return {
      round: r,
      label: roundLabels[r],
      matches: matchesInThisRound.map((m) => ({
        id: m.id,
        bracketIndex: m.bracketIndex,
        status: m.status,
        matchId: m.matchId,
        matchStatus: m.match?.status ?? null,
        matchWinner: m.match?.winner ?? null,
        whiteSlot: m.whiteSlot
          ? {
              seed: m.whiteSlot.seed,
              playerName: m.whiteSlot.player.name,
              playerElo: m.whiteSlot.player.elo,
              winner: m.winnerSlotId === m.whiteSlot.id,
            }
          : null,
        blackSlot: m.blackSlot
          ? {
              seed: m.blackSlot.seed,
              playerName: m.blackSlot.player.name,
              playerElo: m.blackSlot.player.elo,
              winner: m.winnerSlotId === m.blackSlot.id,
            }
          : null,
      })),
    };
  });

  return {
    tournament: {
      id: tournament.id,
      name: tournament.name,
      size: tournament.size,
      status: tournament.status,
      currentRound: tournament.currentRound,
      winnerId: tournament.winnerId,
    },
    rounds: roundsData,
  };
}

function roundLabelsFor(rounds: number): string[] {
  if (rounds === 2) return ["Semifinals", "Final"];
  if (rounds === 3) return ["Quarterfinals", "Semifinals", "Final"];
  if (rounds === 4) return ["Round of 16", "Quarterfinals", "Semifinals", "Final"];
  return Array.from({ length: rounds }, (_, i) => `Round ${i + 1}`);
}
