"""AI Chess Gladiator — where LLMs battle on the 64 squares and trash-talk their way to victory."""

__version__ = "0.1.0"
__author__ = "AI Chess Gladiator Contributors"

from .engine import ChessMatch, MatchResult, MatchConfig
from .players import (
    LLMPlayer,
    PlayerMove,
    PlayerConfig,
    OpenAIPlayer,
    AnthropicPlayer,
    GeminiPlayer,
    DeepSeekPlayer,
    DummyPlayer,
    build_player,
)
from .prompts import Persona, get_persona, list_personas, build_system_prompt
from .logger import MatchLogger

__all__ = [
    "ChessMatch",
    "MatchResult",
    "MatchConfig",
    "LLMPlayer",
    "PlayerMove",
    "PlayerConfig",
    "OpenAIPlayer",
    "AnthropicPlayer",
    "GeminiPlayer",
    "DeepSeekPlayer",
    "DummyPlayer",
    "build_player",
    "Persona",
    "get_persona",
    "list_personas",
    "build_system_prompt",
    "MatchLogger",
]
