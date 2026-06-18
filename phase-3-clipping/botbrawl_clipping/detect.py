"""Blunder detector — scans completed matches and scores each event for
"funny fail" potential, inserting the top candidates into the Highlight table.

Scoring heuristic (higher = funnier):

  RESIGNATION       +60   The AI gave up. Always clip-worthy.
  TIMEOUT           +50   The AI froze. Good clip.
  ILLEGAL_RETRIES   +40   Plus 10 per retry. Multi-retry sequences are gold.
  ILLEGAL_ATTEMPT   +15   A single illegal move that got retried successfully.
  MATERIAL_LOSS     +5    Per point of material lost on the move (queen=9, etc.)
  API_ERROR         +5    Per API error during the move.

Final score is clamped to 0–100. We skip events with score < 20 (not funny
enough to clip).

Usage:
    python -m botbrawl_clipping.detect --db /path/to/custom.db
    python -m botbrawl_clipping.detect --db /path/to/custom.db --match-id <id>
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from dataclasses import dataclass
from typing import Iterable

import chess


# ---------------------------------------------------------------------------
# DB helpers — thin wrappers so the rest of the code is SQL-free
# ---------------------------------------------------------------------------

def connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def list_completed_matches(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute(
        """
        SELECT m.*, w.name AS white_name, w.personaKey AS white_persona,
               b.name AS black_name, b.personaKey AS black_persona
        FROM Match m
        JOIN AIPlayer w ON w.id = m.whiteId
        JOIN AIPlayer b ON b.id = m.blackId
        WHERE m.status = 'COMPLETED'
        ORDER BY m.completedAt DESC
        """
    ).fetchall()


def list_match_events(conn: sqlite3.Connection, match_id: str) -> list[sqlite3.Row]:
    return conn.execute(
        """
        SELECT * FROM MatchEvent
        WHERE matchId = ?
        ORDER BY ply ASC
        """,
        (match_id,),
    ).fetchall()


def existing_highlights_for_match(conn: sqlite3.Connection, match_id: str) -> set[int]:
    rows = conn.execute(
        "SELECT ply FROM Highlight WHERE matchId = ?", (match_id,)
    ).fetchall()
    return {r["ply"] for r in rows}


def insert_highlight(conn: sqlite3.Connection, h: dict) -> str:
    cur = conn.execute(
        """
        INSERT INTO Highlight
            (id, matchId, ply, side, blunderType, blunderScore, title,
             monologue, san, fenBefore, fenAfter, status, createdAt)
        VALUES
            (@id, @matchId, @ply, @side, @blunderType, @blunderScore, @title,
             @monologue, @san, @fenBefore, @fenAfter, 'PENDING', @createdAt)
        """,
        h,
    )
    conn.commit()
    return h["id"]


# ---------------------------------------------------------------------------
# Blunder scoring
# ---------------------------------------------------------------------------

@dataclass
class BlunderCandidate:
    ply: int
    side: str
    blunder_type: str
    blunder_score: int
    monologue: str
    san: str | None
    fen_before: str
    fen_after: str | None


def _material(board: chess.Board) -> int:
    """Compute material balance from White's perspective (positive = White ahead)."""
    values = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3,
              chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}
    score = 0
    for piece_type in values:
        score += len(board.pieces(piece_type, chess.WHITE)) * values[piece_type]
        score -= len(board.pieces(piece_type, chess.BLACK)) * values[piece_type]
    return score


def _clip_title(blunder_type: str, side: str, white_name: str, black_name: str,
                san: str | None) -> str:
    """Auto-generate a clickbaity TikTok-style title."""
    who = white_name if side == "white" else black_name
    if blunder_type == "RESIGNATION":
        return f"{who} GIVES UP mid-game 🏳️"
    if blunder_type == "TIMEOUT":
        return f"{who} forgot how to move 🧠💀"
    if blunder_type == "ILLEGAL_RETRIES":
        return f"{who} tried 3 ILLEGAL moves in a row 🤦"
    if blunder_type == "ILLEGAL_ATTEMPT":
        return f"{who} tried an illegal move: confusion.exe 🤔"
    if blunder_type == "MATERIAL_LOSS" and san:
        return f"{who} blunders material on {san} 💸"
    return f"{who} has a moment 😬"


def score_event(event: sqlite3.Row, board_before: chess.Board,
                board_after: chess.Board | None) -> BlunderCandidate | None:
    """Score one event. Returns None if it's not clip-worthy."""
    etype = event["type"]
    side = event["side"]
    retries = event["retries"] or 0
    api_errors = event["apiErrors"] or 0
    san = event["san"]
    monologue = event["monologue"] or ""

    score = 0
    blunder_type = ""

    if etype == "player_resigned":
        score += 60
        blunder_type = "RESIGNATION"
        # Plus 10 per retry that led to the resignation
        score += min(30, retries * 10)
    elif etype == "player_timeout":
        score += 50
        blunder_type = "TIMEOUT"
    elif etype == "move" and retries > 0:
        if retries >= 3:
            score += 40 + min(30, (retries - 3) * 10)
            blunder_type = "ILLEGAL_RETRIES"
        else:
            score += 15 + retries * 5
            blunder_type = "ILLEGAL_ATTEMPT"
    elif etype == "move" and board_after is not None:
        # Material loss check — did the moving side just lose material?
        mat_before = _material(board_before)
        mat_after = _material(board_after)
        # If White moved and material went down for White, that's a blunder
        if side == "white":
            loss = mat_before - mat_after
        else:
            loss = mat_after - mat_before
        if loss >= 3:  # at least a minor piece
            score += min(40, loss * 5)
            blunder_type = "MATERIAL_LOSS"
        else:
            return None
    else:
        return None

    # API errors add a small bonus (chaos is funny)
    score += min(10, api_errors * 5)

    # Clamp to 0–100
    score = max(0, min(100, score))

    # Skip boring events
    if score < 20:
        return None

    return BlunderCandidate(
        ply=event["ply"],
        side=side,
        blunder_type=blunder_type,
        blunder_score=score,
        monologue=monologue,
        san=san,
        fen_before=board_before.fen(),
        fen_after=board_after.fen() if board_after else None,
    )


# ---------------------------------------------------------------------------
# Main scan loop
# ---------------------------------------------------------------------------

def scan_match(conn: sqlite3.Connection, match: sqlite3.Row) -> int:
    """Scan one completed match for blunders. Returns count of new highlights."""
    match_id = match["id"]
    events = list_match_events(conn, match_id)
    if not events:
        return 0

    already = existing_highlights_for_match(conn, match_id)

    # Replay the game move-by-move, keeping the board state at each event so
    # we can compute material loss. We always start from the standard initial
    # position — the Match table doesn't store a startingFEN.
    board = chess.Board()

    candidates: list[BlunderCandidate] = []
    for event in events:
        board_before = board.copy()
        board_after: chess.Board | None = None

        if event["type"] == "move" and event["san"]:
            try:
                board.push_san(event["san"])
                board_after = board.copy()
            except (chess.IllegalMoveError, chess.InvalidMoveError, chess.AmbiguousMoveError, ValueError):
                # The move was illegal — board stays as-is
                pass

        candidate = score_event(event, board_before, board_after)
        if candidate and candidate.ply not in already:
            candidates.append(candidate)

    # Insert all clip-worthy candidates (we don't dedupe by type — if a match
    # has 3 funny moments, we want 3 clips).
    import time
    import secrets
    white_name = match["white_name"]
    black_name = match["black_name"]

    inserted = 0
    for c in candidates:
        title = _clip_title(c.blunder_type, c.side, white_name, black_name, c.san)
        h = {
            "id": secrets.token_hex(12),  # 24-char hex, similar to cuid length
            "matchId": match_id,
            "ply": c.ply,
            "side": c.side,
            "blunderType": c.blunder_type,
            "blunderScore": c.blunder_score,
            "title": title,
            "monologue": c.monologue,
            "san": c.san,
            "fenBefore": c.fen_before,
            "fenAfter": c.fen_after,
            # Prisma stores SQLite DateTime as INTEGER milliseconds since epoch
            "createdAt": int(time.time() * 1000),
        }
        insert_highlight(conn, h)
        inserted += 1

    return inserted


def main() -> int:
    parser = argparse.ArgumentParser(description="Scan completed BotBrawl matches for blunders.")
    parser.add_argument("--db", required=True, help="Path to the SQLite database file")
    parser.add_argument("--match-id", default=None, help="Only scan this match (optional)")
    args = parser.parse_args()

    conn = connect(args.db)
    try:
        if args.match_id:
            matches = conn.execute(
                """
                SELECT m.*, w.name AS white_name, w.personaKey AS white_persona,
                       b.name AS black_name, b.personaKey AS black_persona
                FROM Match m
                JOIN AIPlayer w ON w.id = m.whiteId
                JOIN AIPlayer b ON b.id = m.blackId
                WHERE m.id = ?
                """,
                (args.match_id,),
            ).fetchall()
        else:
            matches = list_completed_matches(conn)

        total = 0
        for m in matches:
            n = scan_match(conn, m)
            if n:
                print(f"  [{m['id'][:8]}] {m['white_name']} vs {m['black_name']}: {n} highlight(s) added")
            total += n

        print(f"\nDone. {total} highlight(s) inserted across {len(matches)} match(es).")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
