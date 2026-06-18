"""CLI entry point for AI Chess Gladiator.

Examples
--------
# Offline dry-run with two dummy players (no API keys needed):
python -m ai_chess_gladiator \
    --white dummy --black dummy \
    --white-persona overconfident --black-persona doomer

# ChatGPT (overconfident) vs. DeepSeek (cheater):
export OPENAI_API_KEY=sk-...
export DEEPSEEK_API_KEY=sk-...
python -m ai_chess_gladiator \
    --white openai --white-model gpt-4o-mini --white-persona overconfident \
    --black deepseek --black-model deepseek-chat --black-persona cheater \
    --name gpt-vs-deepseek-001

# Claude vs. Gemini, no per-move timeout:
python -m ai_chess_gladiator \
    --white anthropic --white-model claude-3-5-haiku-20241022 --white-persona apologetic \
    --black gemini    --black-model gemini-2.0-flash              --black-persona philosopher \
    --per-move-timeout 0
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path

from .engine import ChessMatch, MatchConfig
from .logger import MatchLogger
from .players import PlayerConfig, build_player
from .prompts import get_persona, list_personas


# Sane default model per provider, so the user doesn't have to remember
# the exact model slug every time.
_DEFAULT_MODELS = {
    "openai": "gpt-4o-mini",
    "anthropic": "claude-3-5-haiku-20241022",
    "gemini": "gemini-2.0-flash",
    "deepseek": "deepseek-chat",
    "dummy": "dummy-1",
}


def _build_player_config(
    provider: str,
    model: str | None,
    persona_key: str,
    side: str,
    temperature: float,
) -> PlayerConfig:
    return PlayerConfig(
        provider=provider,
        model=model or _DEFAULT_MODELS[provider],
        persona=get_persona(persona_key),
        side=side,
        temperature=temperature,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="ai_chess_gladiator",
        description="Watch two LLMs play chess badly. Bring popcorn.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    # ---- White player ----
    parser.add_argument("--white", default="dummy",
                        choices=["openai", "anthropic", "gemini", "deepseek", "dummy"],
                        help="White's LLM provider (default: dummy).")
    parser.add_argument("--white-model", default=None,
                        help="White's model slug. Defaults to a sensible pick per provider.")
    parser.add_argument("--white-persona", default="overconfident",
                        choices=[p.key for p in list_personas()],
                        help="White's trash-talk persona.")

    # ---- Black player ----
    parser.add_argument("--black", default="dummy",
                        choices=["openai", "anthropic", "gemini", "deepseek", "dummy"],
                        help="Black's LLM provider (default: dummy).")
    parser.add_argument("--black-model", default=None,
                        help="Black's model slug. Defaults to a sensible pick per provider.")
    parser.add_argument("--black-persona", default="doomer",
                        choices=[p.key for p in list_personas()],
                        help="Black's trash-talk persona.")

    # ---- Match config ----
    parser.add_argument("--max-plies", type=int, default=200,
                        help="Hard cap on half-moves before the match is declared a draw.")
    parser.add_argument("--per-move-timeout", type=float, default=60.0,
                        help="Per-move timeout in seconds (0 = no timeout). Default 60.")
    parser.add_argument("--illegal-retries", type=int, default=3,
                        help="How many illegal-move retries a player gets before resignation.")
    parser.add_argument("--temperature", type=float, default=0.9,
                        help="Sampling temperature for both players.")

    # ---- Output ----
    parser.add_argument("--name", default=None,
                        help="Match name (used for log filenames). Defaults to a timestamp.")
    parser.add_argument("--log-dir", default="logs",
                        help="Directory to write match logs (default: ./logs).")
    parser.add_argument("--quiet", action="store_true",
                        help="Don't stream events to stdout — only write logs.")

    args = parser.parse_args(argv)

    # Build the two players
    white_cfg = _build_player_config(
        args.white, args.white_model, args.white_persona, "white", args.temperature,
    )
    black_cfg = _build_player_config(
        args.black, args.black_model, args.black_persona, "black", args.temperature,
    )

    try:
        white_player = build_player(white_cfg)
        black_player = build_player(black_cfg)
    except RuntimeError as exc:
        print(f"[setup error] {exc}", file=sys.stderr)
        return 2

    # Build the match
    config = MatchConfig(
        max_plies=args.max_plies,
        per_move_timeout_s=args.per_move_timeout,
        illegal_move_retries=args.illegal_retries,
    )
    match = ChessMatch(white_player, black_player, config)

    # Hook up the logger
    name = args.name or datetime.now().strftime("match-%Y%m%d-%H%M%S")
    logger = MatchLogger(match, Path(args.log_dir), name)

    # Optional stdout streaming
    if not args.quiet:
        from .logger import MatchLogger as _ML  # noqa: F401 (just for clarity)
        # Reuse the text renderer for stdout by listening directly.
        match.on_event(lambda e: print(_stdout_render(e), end=""))

    # Run!
    print(f"\n>>> Starting match: {name}", file=sys.stderr)
    print(f">>> White: {args.white}/{white_cfg.model} ({args.white_persona})", file=sys.stderr)
    print(f">>> Black: {args.black}/{black_cfg.model} ({args.black_persona})", file=sys.stderr)
    print(f">>> Logs:  {Path(args.log_dir).resolve() / name}.(json|txt)\n", file=sys.stderr)

    result = match.run()
    logger.write_summary(result)

    # Final summary
    if result.winner:
        print(f"\n>>> Winner: {result.winner.upper()} — {result.reason}")
    else:
        print(f"\n>>> Draw — {result.reason}")
    print(f">>> {result.plies} plies in {result.duration_s:.1f}s")
    print(f">>> Logs at: {Path(args.log_dir).resolve() / name}.txt")
    return 0


def _stdout_render(event) -> str:
    """Compact one-liner rendering for stdout streaming."""
    from .engine import EventType
    if event.type == EventType.MATCH_START:
        return (
            f"\n{'=' * 60}\n"
            f"  {event.extra.get('white','?')} vs {event.extra.get('black','?')}\n"
            f"{'=' * 60}\n\n"
        )
    if event.type == EventType.MOVE:
        tag = f"  [{event.ply:>3}] {event.side.upper():<5} {event.san:<8}"
        monologue = event.monologue.strip().split("\n")[0][:80]  # first line, truncated
        suffix = f"  ({event.extra.get('elapsed_s', 0):.1f}s"
        if event.extra.get("retries"):
            suffix += f", {event.extra['retries']} retries"
        suffix += ")"
        return f"{tag}{suffix}\n        \"{monologue}\"\n"
    if event.type == EventType.PLAYER_RESIGNED:
        return f"\n  [!!!] {event.side.upper()} RESIGNED.\n        \"{event.monologue.strip()[:120]}\"\n\n"
    if event.type == EventType.PLAYER_TIMEOUT:
        return f"\n  [!!!] {event.side.upper()} TIMED OUT.\n\n"
    if event.type == EventType.MATCH_END:
        winner = event.extra.get("winner")
        if winner:
            head = f"  WINNER: {winner.upper()}"
        else:
            head = "  DRAW"
        return f"\n{'-' * 60}\n{head} — {event.extra.get('reason','')}\n{'-' * 60}\n"
    return ""


if __name__ == "__main__":
    sys.exit(main())
