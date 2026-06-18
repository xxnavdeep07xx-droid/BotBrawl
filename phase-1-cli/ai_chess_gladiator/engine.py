"""The chess match engine.

Wraps `python-chess` and runs a single game between two `LLMPlayer`
instances, enforcing the illegal-move retry policy, time controls, and
emitting structured events that a logger (or future web UI) can consume.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, List, Optional

import chess

from .players import LLMPlayer, PlayerMove


# ---------------------------------------------------------------------------
# Event types — what the match emits as it runs
# ---------------------------------------------------------------------------

class EventType(str, Enum):
    MATCH_START = "match_start"
    MOVE = "move"
    ILLEGAL_ATTEMPT = "illegal_attempt"
    PLAYER_RESIGNED = "player_resigned"
    PLAYER_TIMEOUT = "player_timeout"
    MATCH_END = "match_end"


@dataclass
class MatchEvent:
    type: EventType
    ply: int                       # 1-indexed half-move number
    side: str                      # "white" | "black" | ""
    san: str = ""                  # the move (if applicable)
    monologue: str = ""            # the player's narration
    timestamp: float = field(default_factory=time.time)
    extra: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Match configuration & result
# ---------------------------------------------------------------------------

@dataclass
class MatchConfig:
    """Tunable knobs for a single match."""

    starting_fen: str = chess.STARTING_FEN
    max_plies: int = 200           # hard cap — prevents infinite games
    per_move_timeout_s: float = 60.0  # 0 means no timeout
    illegal_move_retries: int = 3  # forwarded to players


@dataclass
class MatchResult:
    """The outcome of a finished match."""

    winner: Optional[str]          # "white" | "black" | None (draw)
    reason: str                    # human-readable termination reason
    final_fen: str
    final_pgn: str                 # full game in PGN
    plies: int
    events: List[MatchEvent] = field(default_factory=list)
    duration_s: float = 0.0


# ---------------------------------------------------------------------------
# The match itself
# ---------------------------------------------------------------------------

class ChessMatch:
    """Run a single chess match between two LLM players.

    Usage:
        match = ChessMatch(white_player, black_player, config)
        result = match.run()                      # blocking
        # OR stream events:
        for event in match.iter_events():
            handle(event)
    """

    def __init__(
        self,
        white: LLMPlayer,
        black: LLMPlayer,
        config: Optional[MatchConfig] = None,
    ) -> None:
        self.white = white
        self.black = black
        self.config = config or MatchConfig()
        # Override the player retry budgets to match the match config
        for p in (white, black):
            p.config.max_retries = self.config.illegal_move_retries

        self.board = chess.Board(self.config.starting_fen)
        self.history_san: List[str] = []
        self.events: List[MatchEvent] = []
        self._event_listeners: List[Callable[[MatchEvent], None]] = []
        self._start_time: float = 0.0

    # ---- event plumbing -------------------------------------------------

    def on_event(self, listener: Callable[[MatchEvent], None]) -> None:
        """Register a callback that fires for every event."""
        self._event_listeners.append(listener)

    def _emit(self, event: MatchEvent) -> None:
        self.events.append(event)
        for listener in self._event_listeners:
            listener(event)

    # ---- main loop ------------------------------------------------------

    def run(self) -> MatchResult:
        """Run the match to completion and return the result."""
        self._start_time = time.time()
        self._emit(MatchEvent(
            type=EventType.MATCH_START,
            ply=0,
            side="",
            extra={
                "white": f"{self.white.config.provider}/{self.white.config.model}",
                "black": f"{self.black.config.provider}/{self.black.config.model}",
                "white_persona": self.white.config.persona.name,
                "black_persona": self.black.config.persona.name,
                "starting_fen": self.config.starting_fen,
            },
        ))

        winner: Optional[str] = None
        reason = ""

        while True:
            ply = len(self.history_san) + 1
            if ply > self.config.max_plies:
                reason = f"Reached max plies ({self.config.max_plies}) — draw by admin fiat."
                winner = None
                break

            side = "white" if self.board.turn == chess.WHITE else "black"
            player = self.white if self.board.turn == chess.WHITE else self.black

            # Get the move. We use a separate thread with a timeout so a
            # frozen LLM call doesn't hang the whole match forever.
            player_move = self._timed_get_move(player)

            if player_move.san == "":
                # The player gave up (resignation or timeout).
                if player_move.elapsed_s >= self.config.per_move_timeout_s and self.config.per_move_timeout_s > 0:
                    self._emit(MatchEvent(
                        type=EventType.PLAYER_TIMEOUT,
                        ply=ply,
                        side=side,
                        monologue=player_move.monologue,
                        extra={"elapsed_s": player_move.elapsed_s},
                    ))
                    reason = f"{side.capitalize()} timed out after {player_move.elapsed_s:.1f}s."
                else:
                    self._emit(MatchEvent(
                        type=EventType.PLAYER_RESIGNED,
                        ply=ply,
                        side=side,
                        monologue=player_move.monologue,
                        extra={"retries": player_move.retries, "api_errors": player_move.api_errors},
                    ))
                    reason = f"{side.capitalize()} resigned after exhausting retries."
                winner = "black" if side == "white" else "white"
                break

            # We have a legal SAN move. Apply it.
            move = self.board.parse_san(player_move.san)  # safe — already validated
            canonical_san = self.board.san(move)
            self.board.push(move)
            self.history_san.append(canonical_san)

            self._emit(MatchEvent(
                type=EventType.MOVE,
                ply=ply,
                side=side,
                san=canonical_san,
                monologue=player_move.monologue,
                extra={
                    "retries": player_move.retries,
                    "api_errors": player_move.api_errors,
                    "elapsed_s": player_move.elapsed_s,
                    "raw_response": player_move.raw_response,
                },
            ))

            # Check terminal conditions.
            if self.board.is_checkmate():
                reason = f"Checkmate — {side.capitalize()} wins."
                winner = side
                break
            if self.board.is_stalemate():
                reason = "Stalemate — draw."
                winner = None
                break
            if self.board.is_insufficient_material():
                reason = "Insufficient material — draw."
                winner = None
                break
            if self.board.is_seventyfive_moves():
                reason = "Seventyfive-move rule — draw."
                winner = None
                break
            if self.board.is_fivefold_repetition():
                reason = "Fivefold repetition — draw."
                winner = None
                break

        duration = time.time() - self._start_time
        self._emit(MatchEvent(
            type=EventType.MATCH_END,
            ply=len(self.history_san),
            side="",
            extra={"winner": winner, "reason": reason, "duration_s": duration},
        ))

        return MatchResult(
            winner=winner,
            reason=reason,
            final_fen=self.board.fen(),
            final_pgn=self._render_pgn(),
            plies=len(self.history_san),
            events=list(self.events),
            duration_s=duration,
        )

    def iter_events(self):
        """Generator form — yields events as they happen, then returns the result."""
        result_holder: List[MatchResult] = []
        self.on_event(lambda e: None)  # ensure listeners list is non-empty
        # We capture events via the events list rather than yielding directly,
        # because run() is synchronous. Yield from a background queue would be
        # overkill for the CLI use case.
        captured: List[MatchEvent] = []

        def capture(e: MatchEvent) -> None:
            captured.append(e)

        self._event_listeners.append(capture)
        # Run in a thread so we can yield events as they appear.
        import threading
        done = threading.Event()

        def worker() -> None:
            try:
                result_holder.append(self.run())
            finally:
                done.set()

        t = threading.Thread(target=worker, daemon=True)
        t.start()

        last_yielded = 0
        while not done.is_set() or last_yielded < len(captured):
            while last_yielded < len(captured):
                yield captured[last_yielded]
                last_yielded += 1
            time.sleep(0.01)

        while last_yielded < len(captured):
            yield captured[last_yielded]
            last_yielded += 1

        if result_holder:
            return result_holder[0]

    # ---- helpers --------------------------------------------------------

    def _timed_get_move(self, player: LLMPlayer) -> PlayerMove:
        if self.config.per_move_timeout_s <= 0:
            return player.get_move(self.board, list(self.history_san))

        import threading

        result: List[PlayerMove] = []
        exc: List[BaseException] = []

        def worker() -> None:
            try:
                result.append(player.get_move(self.board, list(self.history_san)))
            except BaseException as e:  # noqa: BLE001
                exc.append(e)

        t = threading.Thread(target=worker, daemon=True)
        t.start()
        t.join(timeout=self.config.per_move_timeout_s)

        if t.is_alive():
            # The thread is still running in the background — we can't kill
            # it cleanly in Python, but we'll proceed as if the move timed out.
            return PlayerMove(
                monologue=f"[{player.config.provider}] timed out after {self.config.per_move_timeout_s}s.",
                san="",
                raw_response="",
                elapsed_s=self.config.per_move_timeout_s,
            )
        if exc:
            return PlayerMove(
                monologue=f"[{player.config.provider}] crashed: {exc[0]}",
                san="",
                raw_response="",
                elapsed_s=self.config.per_move_timeout_s,
            )
        return result[0] if result else PlayerMove(
            monologue=f"[{player.config.provider}] returned no move.",
            san="",
            raw_response="",
            elapsed_s=self.config.per_move_timeout_s,
        )

    def _render_pgn(self) -> str:
        """Render the game so far as PGN."""
        # python-chess has a varation generator but it requires the moves as
        # a game tree; easier to build PGN ourselves.
        lines: List[str] = []
        for i in range(0, len(self.history_san), 2):
            move_num = i // 2 + 1
            white_san = self.history_san[i]
            black_san = self.history_san[i + 1] if i + 1 < len(self.history_san) else ""
            if black_san:
                lines.append(f"{move_num}. {white_san} {black_san}")
            else:
                lines.append(f"{move_num}. {white_san}")
        return " ".join(lines)
