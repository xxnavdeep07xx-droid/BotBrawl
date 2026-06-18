# BotBrawl Roadmap

This document tracks the four-phase build of BotBrawl, from a Python CLI prototype to a full live-tournament platform.

---

## ✅ Phase 1 — Prototype (`phase-1-cli/`)

**Status:** Shipped.

A Python CLI where two LLMs play chess against each other with trash talk, illegal-move retries, and match logging. Proves the format works before any web UI.

### What's built
- `python-chess`-backed match loop with full terminal-condition handling (checkmate, stalemate, insufficient material, 75-move rule, fivefold repetition)
- 4 LLM provider integrations (OpenAI, Anthropic, Gemini, DeepSeek) + 1 deterministic `DummyPlayer` for offline testing
- 7 built-in trash-talk personas (apologetic, overconfident, cheater, philosopher, streamer, doomer, robot)
- Per-move timeout + 3-retry illegal-move policy before forced resignation
- JSONL event stream + readable transcript logged per match
- `argparse` CLI for choosing matchup, personas, models, and limits

### What's next
- More personas (community-contributed)
- More LLM providers (Llama, Mistral, Qwen direct integrations)

---

## ✅ Phase 2 — Web MVP (`phase-2-web/`)

**Status:** Shipped.

A full-stack Next.js web app: real-time chessboard + AI monologue stream, virtual Compute Tokens betting system, Elo leaderboard.

### What's built
- 4-tab SPA: **Matches** (schedule + view), **Arena** (live board + chat + bid sidebar), **Leaderboard** (ranked AIs with Elo + W/L/D + win rate), **My Bets** (balance + history)
- Real-time event streaming via socket.io mini-service on port 3003
- 6 seeded AI gladiators (GPT-Rook, Claude-Knight, Gemini-Bishop, DeepSeek-Queen, Llama-Pawn, Mistral-King), each with a different persona
- Virtual Compute Tokens betting system with Elo-derived payout multipliers (clamped 1.1×–8.0×)
- Standard Elo (K=32) leaderboard updated after every match
- All terminal conditions handled (same as Phase 1)
- Prisma + SQLite persistence (User, AIPlayer, Match, MatchEvent, Bet models)
- Daily 1,000-token grant to demo user

### What's next
- Real multi-user auth (currently one shared demo user)
- Persistent match runner (currently in-process — a BullMQ/Redis queue would survive restarts)
- Match replay from DB events (currently the Arena view rebuilds from events on each load, which works but is slow for long games)

---

## 🚧 Phase 3 — Content Launch (`phase-3-clipping/`)

**Status:** Planned. Not started.

Automated pipeline that turns completed matches into shareable short-form video. The "Blunder of the Week" YouTube/TikTok series.

### Planned features
- **Clip extractor**: reads JSONL logs (Phase 1) and DB events (Phase 2), scores each move by "blunder-ness" (using a Stockfish eval diff or a heuristic like "illegal move followed by apology"), picks the top N candidates per week.
- **Frame renderer**: renders each clip as a vertical 9:16 video with the chessboard, the AI's monologue as a subtitle, and a "AI fail" caption.
- **Audio**: AI-generated commentary track over the clip (TTS of the monologue + a human-style "wait, did it just..." reaction).
- **Auto-upload**: scheduled YouTube Shorts / TikTok / Instagram Reels uploads via each platform's API.
- **Submission queue**: human reviews 5 candidates, picks the best, schedules the post.

### Tech under consideration
- `manim` or `remotion` for video rendering
- Stockfish for blunder scoring (or a lighter heuristic for v1)
- `youtube-api` / `tiktok-api` for uploads
- cron-based scheduling (or a simple `setInterval` loop for v1)

---

## 🚧 Phase 4 — Live Tournaments (`phase-4-tournaments/`)

**Status:** Planned. Not started.

Turn BotBrawl into a live entertainment platform with bracket tournaments and audience participation.

### Planned features
- **Bracket system**: single-elimination, double-elimination, round-robin formats. 4-, 8-, 16-AI brackets. Auto-scheduling of subsequent rounds.
- **Livestream integration**: OBS-friendly WebSocket feed of match events (board state, monologue, betting odds) that streamers can overlay on their broadcast.
- **Public user registration + auth**: NextAuth.js with GitHub/Google/email providers. Each user gets 1,000 daily tokens, can buy more (microtransactions, Phase 4+ monetization).
- **Spectator chat**: real-time audience chat alongside the live match (separate from the AI monologue panel).
- **Sponsored tournaments**: tech-company-sponsored "AI Championship Series" with branded UI skins and prize pools.
- **Vote-on-matchups**: premium users can vote on which AIs face off in the next scheduled match.

### Tech under consideration
- NextAuth.js v4 (already in the Phase 2 dependency tree, just not wired up)
- Stripe or Lemon Squeezy for token microtransactions
- A dedicated WebSocket gateway for the spectator chat (separate from the match-event stream)
- OBS WebSocket plugin spec for the broadcast overlay

---

## 🗓️ Rough timeline

| Phase | Estimated effort | Dependencies |
|-------|------------------|--------------|
| 1 — Prototype | 1–2 weeks | None |
| 2 — Web MVP | 2–3 weeks | Phase 1 (for the engine logic to port) |
| 3 — Content Launch | 2–3 weeks | Phases 1 + 2 (for the log/event sources) |
| 4 — Live Tournaments | 4–6 weeks | Phase 2 (for the web app to extend) |

These are solo-dev estimates; a small team could compress each phase by ~40%.
