/**
 * LLM player adapter — uses z-ai-web-dev-sdk to power the AI gladiators.
 *
 * Same shape as Phase 1's Python players: given a chess.js board + history,
 * produce a `{ monologue, san, rawResponse, retries, apiErrors, elapsedMs }`.
 *
 * Illegal-move retry policy: up to 3 retries before forced resignation.
 */

import ZAI from "z-ai-web-dev-sdk";
import { Chess } from "chess.js";
import { buildSystemPrompt, Persona } from "./personas";

export interface PlayerMove {
  monologue: string;
  san: string; // empty string = resignation / failure
  rawResponse: string;
  retries: number;
  apiErrors: number;
  elapsedMs: number;
}

export interface PlayerConfig {
  persona: Persona;
  side: "white" | "black";
  maxRetries: number;
  model?: string; // optional — uses SDK default if omitted
}

const MOVE_LINE_RE = /^[\s>]*MOVE:\s*(.+?)\s*$/im;

/** Split a raw model response into (monologue, san). san is null if no MOVE: line. */
export function parseMoveResponse(raw: string): { monologue: string; san: string | null } {
  const match = raw.match(MOVE_LINE_RE);
  if (!match) {
    return { monologue: raw.trim(), san: null };
  }
  let moveText = match[1].trim();
  // Strip trailing punctuation some models love to add
  moveText = moveText.replace(/[.!?,;]+$/, "").trim();
  const monologue = raw.slice(0, match.index ?? 0).trim();
  return { monologue, san: moveText };
}

/** Build the per-turn user message showing the board to the model. */
function buildUserPrompt(board: Chess, historySan: string[]): string {
  const legalMovesSan = board.moves({ verbose: false }).sort();
  const historyStr = historySan.length ? historySan.join(" ") : "(none yet — this is the opening)";
  const turnPhrase = board.turn() === "w" ? "White" : "Black";

  return (
    `It is ${turnPhrase}'s turn (that's you).\n\n` +
    `FEN: ${board.fen()}\n\n` +
    `Moves so far (SAN): ${historyStr}\n\n` +
    `Your legal moves: ${legalMovesSan.join(", ")}\n\n` +
    `Pick ONE of the legal moves above and output it as \`MOVE: <san>\`.\n` +
    `Remember to narrate IN CHARACTER first, then give the MOVE: line.`
  );
}

// Cache the ZAI instance — the SDK is async to create.
let _zaiPromise: Promise<unknown> | null = null;
async function getZAI(): Promise<any> {
  if (!_zaiPromise) {
    _zaiPromise = ZAI.create();
  }
  return _zaiPromise;
}

/** Run one model call. Throws on transient API errors — caller handles retries. */
async function callModel(systemPrompt: string, userPrompt: string, model?: string): Promise<string> {
  const zai = await getZAI();
  // The z-ai-web-dev-sdk uses 'assistant' role for the system prompt.
  const completion = await zai.chat.completions.create({
    messages: [
      { role: "assistant", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    thinking: { type: "disabled" },
    ...(model ? { model } : {}),
  } as any);
  return completion.choices?.[0]?.message?.content ?? "";
}

/**
 * Run a full turn, including illegal-move retries.
 *
 * @param board     chess.js instance at the position to move from
 * @param history   SAN history so far (for context)
 * @param config    player config
 */
export async function getMove(
  board: Chess,
  history: string[],
  config: PlayerConfig
): Promise<PlayerMove> {
  const systemPrompt = buildSystemPrompt(config.persona, config.side);
  const userPrompt = buildUserPrompt(board, history);
  const start = Date.now();

  let retries = 0;
  let apiErrors = 0;
  let lastMonologue = "";
  let lastRaw = "";
  let lastAttemptedSan = "";

  while (retries <= config.maxRetries) {
    const prompt =
      retries === 0
        ? userPrompt
        : userPrompt +
          `\n\n---\n` +
          `SYSTEM NOTE: Your previous move '${lastAttemptedSan}' was ILLEGAL ` +
          `or could not be parsed. You have ${config.maxRetries - retries + 1} attempt(s) left. ` +
          `Pick a STRICTLY LEGAL move from the list above. Stay in character — ` +
          `maybe apologize, make an excuse, or blame the lighting. Then output \`MOVE: <san>\`.`;

    // 3 retries for transient API errors
    let raw = "";
    let apiError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        raw = await callModel(systemPrompt, prompt, config.model);
        apiError = null;
        break;
      } catch (err) {
        apiError = err as Error;
        apiErrors++;
        if (attempt === 2) break;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }

    if (apiError) {
      return {
        monologue: `[api error after 3 attempts] ${apiError.message}`,
        san: "",
        rawResponse: "",
        retries,
        apiErrors,
        elapsedMs: Date.now() - start,
      };
    }

    lastRaw = raw;
    const { monologue, san } = parseMoveResponse(raw);
    lastMonologue = monologue;
    if (!san) {
      retries++;
      lastAttemptedSan = "(missing)";
      continue;
    }
    lastAttemptedSan = san;

    // Validate the move against the board on a CLONE so we don't mutate.
    try {
      // chess.js move() throws on illegal/ambiguous moves.
      const moveResult = board.move(san);
      if (!moveResult) {
        retries++;
        continue;
      }
      // Undo immediately — the caller decides whether to commit.
      board.undo();
      return {
        monologue: lastMonologue,
        san: moveResult.san, // canonical SAN
        rawResponse: lastRaw,
        retries,
        apiErrors,
        elapsedMs: Date.now() - start,
      };
    } catch {
      retries++;
      continue;
    }
  }

  // Exhausted retries — resign.
  return {
    monologue:
      `${lastMonologue}\n\n[exhausted ${config.maxRetries} retries and resigns in disgrace.]`.trim(),
    san: "",
    rawResponse: lastRaw,
    retries,
    apiErrors,
    elapsedMs: Date.now() - start,
  };
}
