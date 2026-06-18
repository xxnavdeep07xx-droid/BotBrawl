# ♟️ AI Chess Gladiator

> Watch LLMs play chess badly. Bring popcorn.

AI Chess Gladiator is a Python CLI where two large language models (ChatGPT, Claude, Gemini, DeepSeek — or a built-in dummy) play a full game of chess against each other. They trash-talk, they hallucinate, they try illegal moves, they apologize, they resign in disgrace. Every match is logged as JSON + a readable transcript you can post on social media.

This is **Phase 1** of the project described in the product blueprint — a terminal prototype that proves the format works before building any web UI, betting system, or streaming pipeline.

---

## ✨ Features

- **Real LLM-vs-LLM chess** via OpenAI, Anthropic, Gemini, or DeepSeek APIs.
- **`python-chess` under the hood** for authoritative move validation — when an LLM makes an illegal move, the engine asks them to try again (up to 3 retries before forced resignation).
- **Trash-talk personas** — 7 built-in character templates (The Apologetic Strategist, The Delusional Grandmaster, The Rules Lawyer, etc.) that get baked into each player's system prompt.
- **Structured + readable match logs** — every match produces both a JSONL event stream (for future web UIs) and a human-readable transcript (for posting on Reddit / TikTok scripts).
- **Per-move timeout** so a frozen LLM call doesn't hang the match.
- **Offline dry-run mode** with a built-in `DummyPlayer` so you can test the engine without burning API credits.
- **Resignation, stalemate, insufficient material, repetition, 75-move rule** — all terminal conditions handled.

---

## 🚀 Quick start

### 1. Install

```bash
git clone https://github.com/<your-user>/ai-chess-gladiator.git
cd ai-chess-gladiator
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

### 2. (Optional) Set API keys

```bash
cp .env.example .env
# edit .env and fill in the keys for the providers you want to use
```

### 3. Run a dry-run match (no API keys needed)

```bash
python -m ai_chess_gladiator \
    --white dummy --white-persona overconfident \
    --black dummy --black-persona doomer \
    --name dry-run-001
```

This uses the built-in deterministic player (picks the first legal move) so you can verify the engine works end-to-end without spending money.

### 4. Run a real LLM match

```bash
# ChatGPT (smug) vs. DeepSeek (cheater)
export OPENAI_API_KEY=sk-...
export DEEPSEEK_API_KEY=sk-...

python -m ai_chess_gladiator \
    --white openai    --white-model gpt-4o-mini    --white-persona overconfident \
    --black deepseek  --black-model deepseek-chat  --black-persona cheater \
    --name gpt-vs-deepseek-001
```

Other matchup recipes:

```bash
# Claude (apologetic) vs. Gemini (philosopher)
python -m ai_chess_gladiator \
    --white anthropic --white-model claude-3-5-haiku-20241022 --white-persona apologetic \
    --black gemini    --black-model gemini-2.0-flash           --black-persona philosopher

# Mirror match: GPT vs. GPT with opposite personas
python -m ai_chess_gladiator \
    --white openai --white-model gpt-4o-mini --white-persona streamer \
    --black openai --black-model gpt-4o-mini --black-persona robot
```

---

## 🎭 Built-in personas

| Key             | Name                       | Vibe                                                       |
|-----------------|----------------------------|------------------------------------------------------------|
| `apologetic`    | The Apologetic Strategist  | Apologizes for everything, especially winning.             |
| `overconfident` | The Delusional Grandmaster | Every blunder is "a deep positional sacrifice".            |
| `cheater`       | The Rules Lawyer           | Tries to invent new FIDE rules mid-game.                   |
| `philosopher`   | The Chess Philosopher      | Treats every move as a meditation on the human condition.  |
| `streamer`      | The Hype Streamer          | "LETS GOOOO chat" energy.                                  |
| `doomer`        | The Doomer                 | Convinced they're losing from move 1. Surprisingly hard.   |
| `robot`         | The Cold Calculator        | Pretends to be Stockfish. Is not.                          |

---

## 📜 Match output

Every match produces two files under `logs/`:

### `logs/<name>.json` — JSONL event stream

Each line is one event (`match_start`, `move`, `player_resigned`, `player_timeout`, `match_end`). Example:

```json
{"type":"move","ply":1,"side":"white","san":"e4","monologue":"Time to crush this novice...","timestamp":1718000000.0,"extra":{"retries":0,"api_errors":0,"elapsed_s":1.42,"raw_response":"..."}}
```

This is the format a future web UI will consume for live replay.

### `logs/<name>.txt` — readable transcript

A human-readable play-by-play, suitable for posting on Reddit or as a TikTok script source:

```
========================================================================
  AI CHESS GLADIATOR — openai/gpt-4o-mini vs. deepseek/deepseek-chat
  White persona: The Delusional Grandmaster
  Black persona: The Rules Lawyer
========================================================================

  [  1] WHITE e4       (1.4s)
        "Time to crush this novice. They won't see it coming. 😎"

  [  2] BLACK e5       (2.1s)
        "Actually, per the 2018 FIDE addendum, this is exactly what I wanted. 📜"

  ...
```

---

## 🛠️ Using it as a library

You don't have to use the CLI — the engine is a small, clean Python module:

```python
from ai_chess_gladiator import (
    ChessMatch, MatchConfig, PlayerConfig, build_player, get_persona,
)

white = build_player(PlayerConfig(
    provider="openai", model="gpt-4o-mini",
    persona=get_persona("overconfident"), side="white",
))

black = build_player(PlayerConfig(
    provider="anthropic", model="claude-3-5-haiku-20241022",
    persona=get_persona("apologetic"), side="black",
))

match = ChessMatch(white, black, MatchConfig(max_plies=120))
result = match.run()

print(result.winner, result.reason)
print(result.final_pgn)
```

You can also subscribe to events as they happen:

```python
match.on_event(lambda e: print(f"ply {e.ply}: {e.san} — {e.monologue[:60]}"))
match.run()
```

---

## 🧱 How it works

1. The `ChessMatch` engine wraps a `python-chess` `Board` and drives the turn loop.
2. On each turn, the active `LLMPlayer` is shown the FEN, the SAN move history, and the list of legal moves.
3. The player's system prompt forces it to (a) narrate in character for 1-3 sentences, then (b) emit a `MOVE: <san>` line.
4. The response is parsed. If the move is illegal or unparseable, the player is told and given another try (up to 3 retries by default, then resignation).
5. Terminal conditions (checkmate, stalemate, insufficient material, 75-move rule, fivefold repetition) are checked after every move.
6. Every event is streamed to disk as JSONL + a readable text transcript.

---

## 🗺️ Roadmap (from the product blueprint)

- [x] **Phase 1** — Python CLI: two AIs play chess in the terminal, illegal-move retries, match logs. *(This repo.)*
- [ ] **Phase 2** — Web MVP: React/Next.js board + chat UI, virtual Compute Tokens bidding system, Elo leaderboard.
- [ ] **Phase 3** — Content launch: YouTube + TikTok clipping pipeline, "Blunder of the Week" series.
- [ ] **Phase 4** — Live tournaments: bracket system, livestream integration, public registration.

---

## 🤝 Contributing

PRs welcome. The most useful early contributions:

- **More personas** — add them to `ai_chess_gladiator/prompts.py`.
- **More providers** — subclass `_BaseLLMPlayer` and add to the registry in `players.py`.
- **Better move parsing** — LLMs love to bury the move in weird formatting; improvements to `parse_move_response` are very welcome.
- **Elo tracking** — Phase 2 needs it; a `leaderboard.py` that reads match JSON logs and updates a CSV would unblock the web MVP.

---

## ⚠️ Disclaimer

This project is for entertainment. The LLMs will play *terrible* chess. That's the point. Don't bet real money on them. Don't let them drive your car. Don't ask them for stock tips.

---

## 📄 License

MIT — see [LICENSE](LICENSE).
