/**
 * The chess match engine — TypeScript port of Phase 1's Python engine.
 *
 * Wraps chess.js and runs a single game between two LLM players,
 * enforcing the illegal-move retry policy, time controls, and emitting
 * structured events that the socket.io service streams to clients.
 */

import { Chess } from "chess.js";
import { getMove, PlayerConfig, PlayerMove } from "./llm-player";

export type EventType =
  | "match_start"
  | "move"
  | "player_resigned"
  | "player_timeout"
  | "match_end";

export interface MatchEvent {
  type: EventType;
  ply: number;
  side: "white" | "black" | "";
  san?: string;
  monologue?: string;
  retries?: number;
  apiErrors?: number;
  elapsedMs?: number;
  rawResponse?: string;
  timestamp: number;
  extra?: Record<string, unknown>;
}

export interface MatchConfig {
  maxPlies: number;
  perMoveTimeoutMs: number; // 0 = no timeout
  illegalMoveRetries: number;
}

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  maxPlies: 120,
  perMoveTimeoutMs: 30_000,
  illegalMoveRetries: 3,
};

export interface MatchResult {
  winner: "white" | "black" | null;
  reason: string;
  finalFen: string;
  pgn: string;
  plies: number;
  events: MatchEvent[];
  durationMs: number;
}

export type EventListener = (event: MatchEvent) => void;

/**
 * Run a single chess match between two LLM players.
 *
 * The function is a generator-like async function — pass an `onEvent`
 * callback to stream events as they happen (used by the socket.io service
 * for live updates).
 */
export async function runMatch(
  whiteConfig: PlayerConfig,
  blackConfig: PlayerConfig,
  config: MatchConfig,
  onEvent: EventListener
): Promise<MatchResult> {
  const board = new Chess();
  const history: string[] = [];
  const events: MatchEvent[] = [];
  const startTime = Date.now();

  const emit = (e: MatchEvent) => {
    events.push(e);
    onEvent(e);
  };

  emit({
    type: "match_start",
    ply: 0,
    side: "",
    timestamp: Date.now(),
    extra: {
      white: `${whiteConfig.persona.name}`,
      black: `${blackConfig.persona.name}`,
    },
  });

  let winner: "white" | "black" | null = null;
  let reason = "";

  while (true) {
    const ply = history.length + 1;
    if (ply > config.maxPlies) {
      reason = `Reached max plies (${config.maxPlies}) — draw by admin fiat.`;
      winner = null;
      break;
    }

    const side: "white" | "black" = board.turn() === "w" ? "white" : "black";
    const playerConfig = side === "white" ? whiteConfig : blackConfig;

    // Get the move (with optional timeout).
    const playerMove: PlayerMove = await timedGetMove(
      board,
      history,
      playerConfig,
      config.perMoveTimeoutMs
    );

    if (playerMove.san === "") {
      // Resignation or timeout.
      if (
        config.perMoveTimeoutMs > 0 &&
        playerMove.elapsedMs >= config.perMoveTimeoutMs
      ) {
        emit({
          type: "player_timeout",
          ply,
          side,
          monologue: playerMove.monologue,
          retries: playerMove.retries,
          apiErrors: playerMove.apiErrors,
          elapsedMs: playerMove.elapsedMs,
          timestamp: Date.now(),
        });
        reason = `${side} timed out after ${playerMove.elapsedMs}ms.`;
      } else {
        emit({
          type: "player_resigned",
          ply,
          side,
          monologue: playerMove.monologue,
          retries: playerMove.retries,
          apiErrors: playerMove.apiErrors,
          elapsedMs: playerMove.elapsedMs,
          rawResponse: playerMove.rawResponse,
          timestamp: Date.now(),
        });
        reason = `${side} resigned after exhausting retries.`;
      }
      winner = side === "white" ? "black" : "white";
      break;
    }

    // Commit the legal move.
    const moveResult = board.move(playerMove.san);
    history.push(moveResult.san);

    emit({
      type: "move",
      ply,
      side,
      san: moveResult.san,
      monologue: playerMove.monologue,
      retries: playerMove.retries,
      apiErrors: playerMove.apiErrors,
      elapsedMs: playerMove.elapsedMs,
      rawResponse: playerMove.rawResponse,
      timestamp: Date.now(),
    });

    // Check terminal conditions.
    if (board.isCheckmate()) {
      reason = `Checkmate — ${side} wins.`;
      winner = side;
      break;
    }
    if (board.isStalemate()) {
      reason = "Stalemate — draw.";
      winner = null;
      break;
    }
    if (board.isInsufficientMaterial()) {
      reason = "Insufficient material — draw.";
      winner = null;
      break;
    }
    if (board.isThreefoldRepetition()) {
      reason = "Threefold repetition — draw.";
      winner = null;
      break;
    }
    if (board.isDraw()) {
      reason = "Draw (50-move rule or other).";
      winner = null;
      break;
    }
  }

  const durationMs = Date.now() - startTime;
  emit({
    type: "match_end",
    ply: history.length,
    side: "",
    timestamp: Date.now(),
    extra: {
      winner,
      reason,
      durationMs,
    },
  });

  return {
    winner,
    reason,
    finalFen: board.fen(),
    pgn: board.pgn(),
    plies: history.length,
    events,
    durationMs,
  };
}

/**
 * Wrap getMove in a Promise.race against a timeout. If the timeout fires,
 * return a synthetic PlayerMove with empty san (treated as resignation).
 */
async function timedGetMove(
  board: Chess,
  history: string[],
  config: PlayerConfig,
  timeoutMs: number
): Promise<PlayerMove> {
  if (timeoutMs <= 0) {
    return getMove(board, history, config);
  }

  // Snapshot the board so the LLM player can clone-validate moves safely.
  // chess.js is mutable, so we pass the live board to getMove (which
  // tries+undo's) and trust the single-threaded async model.

  let timeoutHandle: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<PlayerMove>((resolve) => {
    timeoutHandle = setTimeout(() => {
      resolve({
        monologue: `[timed out after ${timeoutMs}ms]`,
        san: "",
        rawResponse: "",
        retries: 0,
        apiErrors: 0,
        elapsedMs: timeoutMs,
      });
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([
      getMove(board, history, config),
      timeoutPromise,
    ]);
    return result;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
