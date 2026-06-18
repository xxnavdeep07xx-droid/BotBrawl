"""Match logging — write structured JSON + a human-readable transcript.

Two artifacts are produced per match:

1. `<name>.json`  — full structured event log, suitable for replay/UI feeds.
2. `<name>.txt`   — a readable play-by-play transcript with monologues,
                    suitable for posting as a "match log" on social media.
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict
from pathlib import Path
from typing import Optional

from .engine import ChessMatch, EventType, MatchEvent, MatchResult
from .players import LLMPlayer


class MatchLogger:
    """Listen to match events and persist them to disk."""

    def __init__(self, match: ChessMatch, log_dir: str | Path, name: str) -> None:
        self.match = match
        self.log_dir = Path(log_dir)
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.name = name
        self.json_path = self.log_dir / f"{name}.json"
        self.txt_path = self.log_dir / f"{name}.txt"
        match.on_event(self._on_event)

    # The logger keeps no in-memory state — it streams to disk so that even
    # if the match crashes partway through, you still have a partial log.

    def _on_event(self, event: MatchEvent) -> None:
        # Append the event as a single JSON line (JSONL) — easy to stream,
        # easy to grep, easy to feed into a future web UI.
        payload = {
            "type": event.type.value,
            "ply": event.ply,
            "side": event.side,
            "san": event.san,
            "monologue": event.monologue,
            "timestamp": event.timestamp,
            "extra": _jsonable(event.extra),
        }
        with self.json_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")

        # Append the readable transcript line(s).
        with self.txt_path.open("a", encoding="utf-8") as f:
            f.write(self._render_text(event))

    # ---- text rendering -------------------------------------------------

    def _render_text(self, event: MatchEvent) -> str:
        if event.type == EventType.MATCH_START:
            return (
                f"\n{'=' * 72}\n"
                f"  AI CHESS GLADIATOR — {event.extra.get('white', '?')} vs {event.extra.get('black', '?')}\n"
                f"  White persona: {event.extra.get('white_persona', '?')}\n"
                f"  Black persona: {event.extra.get('black_persona', '?')}\n"
                f"{'=' * 72}\n\n"
            )
        if event.type == EventType.MOVE:
            tag = f"  [{event.ply:>3}] {event.side.upper():<5} {event.san:<8}"
            monologue = event.monologue.strip().replace("\n", "\n        ")
            elapsed = event.extra.get("elapsed_s", 0.0)
            retries = event.extra.get("retries", 0)
            api_errs = event.extra.get("api_errors", 0)
            suffix_bits = [f"{elapsed:.1f}s"]
            if retries:
                suffix_bits.append(f"{retries} retries")
            if api_errs:
                suffix_bits.append(f"{api_errs} API errs")
            suffix = f"  ({', '.join(suffix_bits)})"
            return f"{tag}{suffix}\n        \"{monologue}\"\n\n"
        if event.type == EventType.PLAYER_RESIGNED:
            return f"\n  [!!!] {event.side.upper()} RESIGNED.\n        \"{event.monologue.strip()}\"\n\n"
        if event.type == EventType.PLAYER_TIMEOUT:
            return f"\n  [!!!] {event.side.upper()} TIMED OUT after {event.extra.get('elapsed_s', 0):.1f}s.\n\n"
        if event.type == EventType.MATCH_END:
            winner = event.extra.get("winner")
            reason = event.extra.get("reason", "")
            duration = event.extra.get("duration_s", 0.0)
            if winner:
                header = f"  WINNER: {winner.upper()}  ({duration:.1f}s, {event.ply} plies)"
            else:
                header = f"  DRAW  ({duration:.1f}s, {event.ply} plies)"
            return (
                f"\n{'-' * 72}\n"
                f"{header}\n"
                f"  Reason: {reason}\n"
                f"{'-' * 72}\n"
            )
        return ""

    # ---- final summary writer ------------------------------------------

    def write_summary(self, result: MatchResult) -> None:
        """Append a final PGN + result block to the .txt log."""
        with self.txt_path.open("a", encoding="utf-8") as f:
            f.write("\nPGN:\n")
            f.write(result.final_pgn or "(no moves played)")
            f.write("\n\nFEN at end: " + result.final_fen + "\n")


def _jsonable(obj):
    """Best-effort recursive JSON coercion for arbitrary extra payloads."""
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, dict):
        return {str(k): _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_jsonable(v) for v in obj]
    return str(obj)
