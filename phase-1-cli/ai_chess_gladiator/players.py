"""LLM player implementations.

All players conform to a single protocol: given a board snapshot (FEN + SAN
history + legal-move list), produce a `PlayerMove` containing the raw
monologue and a parsed SAN move.

We support four real providers out of the box (OpenAI, Anthropic, Gemini,
DeepSeek) plus a deterministic `DummyPlayer` for offline testing.
"""

from __future__ import annotations

import os
import re
import time
from dataclasses import dataclass, field
from typing import List, Optional, Protocol

import chess

from .prompts import Persona, build_system_prompt


# ---------------------------------------------------------------------------
# Public dataclasses
# ---------------------------------------------------------------------------

@dataclass
class PlayerConfig:
    """Configuration for an LLM player."""

    provider: str           # "openai" | "anthropic" | "gemini" | "deepseek" | "dummy"
    model: str              # e.g. "gpt-4o-mini", "claude-3-5-sonnet-20241022"
    persona: Persona
    side: str               # "white" | "black"
    api_key_env: str = ""   # env var name holding the API key (empty for dummy)
    temperature: float = 0.9
    max_tokens: int = 400
    max_retries: int = 3    # retries for ILLEGAL moves (not API errors)


@dataclass
class PlayerMove:
    """One move as produced by a player."""

    monologue: str          # the in-character narration, pre-MOVE line
    san: str                # parsed SAN move, e.g. "Nf3"
    raw_response: str       # full raw model output, for debugging
    retries: int = 0        # how many illegal-move retries happened
    api_errors: int = 0     # how many transient API errors happened
    elapsed_s: float = 0.0


class LLMPlayer(Protocol):
    """The contract every player must satisfy."""

    config: PlayerConfig

    def get_move(self, board: chess.Board, history_san: List[str]) -> PlayerMove:
        ...


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

_MOVE_LINE_RE = re.compile(r"^\s*MOVE:\s*(.+?)\s*$", re.IGNORECASE | re.MULTILINE)


def parse_move_response(raw: str) -> tuple[str, Optional[str]]:
    """Split a raw model response into (monologue, san).

    Returns (monologue, None) if no MOVE: line was found.
    """
    match = _MOVE_LINE_RE.search(raw)
    if not match:
        return raw.strip(), None

    move_text = match.group(1).strip()
    # Strip trailing punctuation some models love to add
    move_text = move_text.rstrip(".!?,;").strip()

    monologue = raw[: match.start()].strip()
    return monologue, move_text


def _build_user_prompt(board: chess.Board, history_san: List[str]) -> str:
    """The per-turn user message showing the board to the model."""
    legal_moves_san = sorted(
        board.san(move) for move in board.legal_moves
    )
    history_str = " ".join(history_san) if history_san else "(none yet — this is the opening)"
    turn_phrase = "White" if board.turn == chess.WHITE else "Black"

    return (
        f"It is {turn_phrase}'s turn (that's you).\n\n"
        f"FEN: {board.fen()}\n\n"
        f"Moves so far (SAN): {history_str}\n\n"
        f"Your legal moves: {', '.join(legal_moves_san)}\n\n"
        f"Pick ONE of the legal moves above and output it as `MOVE: <san>`.\n"
        f"Remember to narrate IN CHARACTER first, then give the MOVE: line."
    )


# ---------------------------------------------------------------------------
# Provider implementations
# ---------------------------------------------------------------------------

class _BaseLLMPlayer:
    """Shared scaffolding for the real-provider players."""

    provider_name: str = "base"

    def __init__(self, config: PlayerConfig):
        self.config = config
        self._system_prompt = build_system_prompt(config.persona, config.side)

    # Subclasses implement this — return the raw model text.
    def _call_model(self, user_prompt: str) -> str:
        raise NotImplementedError

    def get_move(self, board: chess.Board, history_san: List[str]) -> PlayerMove:
        """Run the full turn loop, including illegal-move retries."""
        user_prompt = _build_user_prompt(board, history_san)
        retries = 0
        api_errors = 0
        start = time.time()
        last_monologue = ""
        last_raw = ""

        while retries <= self.config.max_retries:
            # Build the user prompt, optionally appending a "your last move
            # was illegal" note on retries.
            if retries == 0:
                prompt = user_prompt
            else:
                prompt = (
                    f"{user_prompt}\n\n"
                    f"---\n"
                    f"SYSTEM NOTE: Your previous move '{last_attempted_san}' was ILLEGAL "
                    f"or could not be parsed. You have "
                    f"{self.config.max_retries - retries + 1} attempt(s) left. "
                    f"Pick a STRICTLY LEGAL move from the list above. Stay in character — "
                    f"maybe apologize, make an excuse, or blame the lighting. Then output `MOVE: <san>`."
                )

            # Call the model with a small retry budget for transient errors.
            raw = None
            for attempt in range(3):
                try:
                    raw = self._call_model(prompt)
                    break
                except Exception as exc:  # noqa: BLE001 — we want to catch all API hiccups
                    api_errors += 1
                    if attempt == 2:
                        # Give up: treat as a resignation
                        return PlayerMove(
                            monologue=f"[{self.provider_name}] API error after 3 attempts: {exc}",
                            san="",
                            raw_response="",
                            retries=retries,
                            api_errors=api_errors,
                            elapsed_s=time.time() - start,
                        )
                    time.sleep(1.5 * (attempt + 1))

            last_raw = raw or ""
            monologue, san = parse_move_response(last_raw)
            last_monologue = monologue
            last_attempted_san = san or ""

            if san is None:
                retries += 1
                continue

            # Try to parse + apply the move on a copy so we don't mutate the board.
            try:
                move = board.parse_san(san)
            except (chess.IllegalMoveError, chess.InvalidMoveError, chess.AmbiguousMoveError, ValueError):
                retries += 1
                continue

            # Legal! Normalize SAN (parse_san returns the move object; board.san
            # gives canonical SAN).
            canonical_san = board.san(move)
            return PlayerMove(
                monologue=last_monologue,
                san=canonical_san,
                raw_response=last_raw,
                retries=retries,
                api_errors=api_errors,
                elapsed_s=time.time() - start,
            )

        # Exhausted retries — resign.
        return PlayerMove(
            monologue=(
                f"{last_monologue}\n\n"
                f"[{self.provider_name}] exhausted {self.config.max_retries} retries "
                f"and resigns in disgrace."
            ).strip(),
            san="",
            raw_response=last_raw,
            retries=retries,
            api_errors=api_errors,
            elapsed_s=time.time() - start,
        )


class OpenAIPlayer(_BaseLLMPlayer):
    provider_name = "openai"

    def __init__(self, config: PlayerConfig):
        super().__init__(config)
        from openai import OpenAI  # type: ignore
        api_key = os.environ.get(config.api_key_env or "OPENAI_API_KEY", "")
        if not api_key:
            raise RuntimeError(
                f"OpenAI API key not found. Set ${config.api_key_env or 'OPENAI_API_KEY'}."
            )
        self._client = OpenAI(api_key=api_key)

    def _call_model(self, user_prompt: str) -> str:
        resp = self._client.chat.completions.create(
            model=self.config.model,
            temperature=self.config.temperature,
            max_tokens=self.config.max_tokens,
            messages=[
                {"role": "system", "content": self._system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        return resp.choices[0].message.content or ""


class AnthropicPlayer(_BaseLLMPlayer):
    provider_name = "anthropic"

    def __init__(self, config: PlayerConfig):
        super().__init__(config)
        from anthropic import Anthropic  # type: ignore
        api_key = os.environ.get(config.api_key_env or "ANTHROPIC_API_KEY", "")
        if not api_key:
            raise RuntimeError(
                f"Anthropic API key not found. Set ${config.api_key_env or 'ANTHROPIC_API_KEY'}."
            )
        self._client = Anthropic(api_key=api_key)

    def _call_model(self, user_prompt: str) -> str:
        resp = self._client.messages.create(
            model=self.config.model,
            max_tokens=self.config.max_tokens,
            temperature=self.config.temperature,
            system=self._system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        # Anthropic returns a list of content blocks; we want the text ones.
        parts = [block.text for block in resp.content if getattr(block, "type", "") == "text"]
        return "".join(parts)


class GeminiPlayer(_BaseLLMPlayer):
    provider_name = "gemini"

    def __init__(self, config: PlayerConfig):
        super().__init__(config)
        try:
            from google import genai  # type: ignore  # new google-genai SDK
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError(
                "Install the Google GenAI SDK: `pip install google-genai`"
            ) from exc

        api_key = os.environ.get(config.api_key_env or "GEMINI_API_KEY", "")
        if not api_key:
            raise RuntimeError(
                f"Gemini API key not found. Set ${config.api_key_env or 'GEMINI_API_KEY'}."
            )
        self._client = genai.Client(api_key=api_key)

    def _call_model(self, user_prompt: str) -> str:
        # The new google-genai SDK accepts a 'system_instruction' field on generate_content.
        resp = self._client.models.generate_content(
            model=self.config.model,
            contents=user_prompt,
            config={
                "temperature": self.config.temperature,
                "max_output_tokens": self.config.max_tokens,
                "system_instruction": self._system_prompt,
            },
        )
        return getattr(resp, "text", "") or ""


class DeepSeekPlayer(_BaseLLMPlayer):
    """DeepSeek speaks the OpenAI protocol — just point the base_url at their server."""

    provider_name = "deepseek"

    def __init__(self, config: PlayerConfig):
        super().__init__(config)
        from openai import OpenAI  # type: ignore
        api_key = os.environ.get(config.api_key_env or "DEEPSEEK_API_KEY", "")
        if not api_key:
            raise RuntimeError(
                f"DeepSeek API key not found. Set ${config.api_key_env or 'DEEPSEEK_API_KEY'}."
            )
        self._client = OpenAI(api_key=api_key, base_url="https://api.deepseek.com")

    def _call_model(self, user_prompt: str) -> str:
        resp = self._client.chat.completions.create(
            model=self.config.model,
            temperature=self.config.temperature,
            max_tokens=self.config.max_tokens,
            messages=[
                {"role": "system", "content": self._system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        return resp.choices[0].message.content or ""


class DummyPlayer(_BaseLLMPlayer):
    """A deterministic offline player for testing the engine without API keys.

    Picks the first legal move in SAN order and emits a tiny canned monologue.
    Useful for `python -m ai_chess_gladiator --dry-run`.
    """

    provider_name = "dummy"

    def __init__(self, config: PlayerConfig):
        super().__init__(config)

    def _call_model(self, user_prompt: str) -> str:
        # Extract the first legal move from the prompt itself (it's right there).
        match = re.search(r"Your legal moves: (.+?)\n", user_prompt)
        if not match:
            return "I have no moves. MOVE: e4"
        first_move = match.group(1).split(",")[0].strip()
        return (
            f"({self.config.persona.name}) I will play the safest legal move available. "
            f"{self.config.persona.emoji_palette[0] if self.config.persona.emoji_palette else ''}\n"
            f"MOVE: {first_move}"
        )

    def get_move(self, board: chess.Board, history_san: List[str]) -> PlayerMove:  # noqa: D401
        # Override to skip the retry loop entirely — DummyPlayer never produces
        # an illegal move because it reads the legal-move list directly.
        start = time.time()
        raw = self._call_model(_build_user_prompt(board, history_san))
        monologue, san = parse_move_response(raw)
        # Canonicalize
        move = board.parse_san(san or "e4")
        canonical = board.san(move)
        return PlayerMove(
            monologue=monologue,
            san=canonical,
            raw_response=raw,
            retries=0,
            api_errors=0,
            elapsed_s=time.time() - start,
        )


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

_PROVIDER_REGISTRY = {
    "openai": OpenAIPlayer,
    "anthropic": AnthropicPlayer,
    "gemini": GeminiPlayer,
    "deepseek": DeepSeekPlayer,
    "dummy": DummyPlayer,
}


def build_player(config: PlayerConfig) -> LLMPlayer:
    """Instantiate the right player class for the configured provider."""
    provider = config.provider.lower()
    if provider not in _PROVIDER_REGISTRY:
        available = ", ".join(sorted(_PROVIDER_REGISTRY))
        raise ValueError(
            f"Unknown provider '{provider}'. Available: {available}"
        )
    cls = _PROVIDER_REGISTRY[provider]
    return cls(config)
