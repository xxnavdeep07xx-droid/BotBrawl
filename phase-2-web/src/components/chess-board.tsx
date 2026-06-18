"use client";

import { useMemo } from "react";
import { Chess, Square } from "chess.js";

/**
 * A self-contained SVG chessboard. Renders the position from a FEN string
 * and highlights the last move's source + destination squares.
 *
 * Pieces are rendered as Unicode glyphs — minimal deps, looks clean, and
 * the point of this app is the LLM banter, not chess piece aesthetics.
 */

const PIECE_GLYPHS: Record<string, string> = {
  p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚",
  P: "♙", N: "♘", B: "♗", R: "♖", Q: "♕", K: "♔",
};

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"];

interface ChessBoardProps {
  fen: string;
  lastMove?: { from: string; to: string } | null;
  size?: number; // px
}

export function ChessBoard({ fen, lastMove, size = 480 }: ChessBoardProps) {
  // Parse the FEN into a square->piece map.
  const squares = useMemo(() => {
    const board = new Chess(fen);
    const map: Record<string, string> = {};
    for (const square of Array.from({ length: 64 }, (_, i) => {
      const file = FILES[i % 8];
      const rank = RANKS[Math.floor(i / 8)];
      return `${file}${rank}` as Square;
    })) {
      const piece = board.get(square);
      if (piece) map[square] = piece.color === "w" ? piece.type.toUpperCase() : piece.type;
    }
    return map;
  }, [fen]);

  const cellSize = size / 8;

  return (
    <div
      className="inline-block rounded-lg overflow-hidden shadow-xl border border-zinc-300 dark:border-zinc-700"
      style={{ width: size, height: size }}
    >
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        {/* Squares */}
        {RANKS.map((rank, rIdx) =>
          FILES.map((file, fIdx) => {
            const square = `${file}${rank}`;
            const isLight = (rIdx + fIdx) % 2 === 0;
            const isLastFrom = lastMove?.from === square;
            const isLastTo = lastMove?.to === square;
            const piece = squares[square];

            let fill = isLight ? "#f0d9b5" : "#b58863";
            if (isLastFrom || isLastTo) fill = isLight ? "#f6f669" : "#cdd26a";

            return (
              <g key={square}>
                <rect
                  x={fIdx * cellSize}
                  y={rIdx * cellSize}
                  width={cellSize}
                  height={cellSize}
                  fill={fill}
                />
                {piece && (
                  <text
                    x={fIdx * cellSize + cellSize / 2}
                    y={rIdx * cellSize + cellSize / 2}
                    dominantBaseline="central"
                    textAnchor="middle"
                    fontSize={cellSize * 0.75}
                    fill={piece === piece.toUpperCase() ? "#ffffff" : "#1a1a1a"}
                    stroke={piece === piece.toUpperCase() ? "#1a1a1a" : "#ffffff"}
                    strokeWidth={1.2}
                    style={{ userSelect: "none", cursor: "default" }}
                  >
                    {PIECE_GLYPHS[piece]}
                  </text>
                )}
              </g>
            );
          })
        )}
        {/* File labels */}
        {FILES.map((file, fIdx) => (
          <text
            key={`f-${file}`}
            x={fIdx * cellSize + cellSize - 4}
            y={size - 4}
            fontSize={cellSize * 0.18}
            fill={fIdx % 2 === 0 ? "#b58863" : "#f0d9b5"}
            textAnchor="end"
          >
            {file}
          </text>
        ))}
        {/* Rank labels */}
        {RANKS.map((rank, rIdx) => (
          <text
            key={`r-${rank}`}
            x={4}
            y={rIdx * cellSize + cellSize * 0.18 + 2}
            fontSize={cellSize * 0.18}
            fill={rIdx % 2 === 0 ? "#b58863" : "#f0d9b5"}
            textAnchor="start"
          >
            {rank}
          </text>
        ))}
      </svg>
    </div>
  );
}
