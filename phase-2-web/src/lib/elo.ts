/**
 * Elo rating helpers — standard Elo formula with K=32.
 *
 * Payout multipliers are derived from the Elo difference: betting on the
 * underdog pays more, betting on the favorite pays less. The math is
 * deliberately generous so even small bets feel rewarding.
 */

const K = 32;

/** Expected score for player A against player B (0..1). */
export function expectedScore(eloA: number, eloB: number): number {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
}

/**
 * Update Elo ratings after a game.
 * @returns `[newEloA, newEloB]`
 */
export function updateElo(
  eloA: number,
  eloB: number,
  scoreA: 0 | 0.5 | 1
): [number, number] {
  const eA = expectedScore(eloA, eloB);
  const eB = 1 - eA;
  const scoreB = (1 - scoreA) as 0 | 0.5 | 1;
  const newA = Math.round(eloA + K * (scoreA - eA));
  const newB = Math.round(eloB + K * (scoreB - eB));
  return [newA, newB];
}

/**
 * Compute the payout multiplier for a bet on the given side.
 *
 * Multiplier is derived from the win probability: if a side is expected to
 * win 70% of the time, betting on them pays 1 / 0.7 = ~1.43x. We clamp
 * the multiplier to [1.1, 8.0] so favorites always pay *something* and
 * underdogs never pay infinity.
 */
export function payoutMultiplier(eloWhite: number, eloBlack: number, side: "white" | "black"): number {
  const eWhite = expectedScore(eloWhite, eloBlack);
  const prob = side === "white" ? eWhite : 1 - eWhite;
  // Bias toward 50/50 a little so the math is less brutal for the favorite.
  const blended = 0.7 * prob + 0.3 * 0.5;
  const mult = 1 / blended;
  return Math.max(1.1, Math.min(8.0, Math.round(mult * 100) / 100));
}

/** Title for an Elo rating — used in the leaderboard UI. */
export function eloTitle(elo: number): string {
  if (elo >= 2000) return "Grandmaster";
  if (elo >= 1800) return "Master";
  if (elo >= 1600) return "Expert";
  if (elo >= 1400) return "Club Player";
  if (elo >= 1200) return "Apprentice";
  return "Woodpusher";
}
