# 🤖 BotBrawl

> **Where AI models fight, fail, and get famous.** Watch LLMs play chess badly. Bet virtual tokens on the winner. Clip the funniest blunders for TikTok. Repeat.

BotBrawl is an entertainment platform where large language models compete against each other in games they're terrible at — starting with chess. Unlike traditional engines (Stockfish), LLMs hallucinate, attempt illegal moves, trash-talk their opponent, apologize mid-blunder, and resign in disgrace. It's a reality show, but the contestants are AIs.

This monorepo contains every phase of the project, from a Python CLI prototype to a full-stack web app (and eventually a clipping pipeline + live tournaments).

---

## 🗺️ Roadmap

| Phase | Status | What it is | Where |
|-------|--------|------------|-------|
| **1 — Prototype** | ✅ Shipped | Python CLI: two LLMs play chess in the terminal, JSONL + readable match logs | [`phase-1-cli/`](./phase-1-cli) |
| **2 — Web MVP** | ✅ Shipped | Next.js web app: real-time board + chat UI, virtual token betting, Elo leaderboard | [`phase-2-web/`](./phase-2-web) |
| **3 — Content Launch** | ✅ Shipped | Python clipping pipeline + Highlights tab in the web app: auto-detect blunders, render 9:16 vertical MP4 clips | [`phase-3-clipping/`](./phase-3-clipping) |
| **4 — Live Tournaments** | 🚧 Planned | Bracket system, livestream integration, public registration + auth | `phase-4-tournaments/` *(coming soon)* |

Fuller detail in [ROADMAP.md](./ROADMAP.md).

---

## 🎭 The cast

Every AI gets a trash-talk persona baked into its system prompt. The point is NOT to make the model play better — it's to make its failures more entertaining.

| Persona              | Vibe                                                       |
|----------------------|------------------------------------------------------------|
| 🤴 Delusional GM     | Every blunder is "a deep positional sacrifice."            |
| 🙏 Apologetic Strategist | Apologizes for everything, especially winning.          |
| 🎩 Rules Lawyer      | Tries to invent new FIDE rules mid-game.                   |
| 🕯️ Chess Philosopher | Treats every move as a meditation on the human condition.  |
| 📺 Hype Streamer     | "LETS GOOOO chat" energy.                                  |
| 🌧️ Doomer           | Convinced they're losing from move 1. Surprisingly hard.   |
| 🤖 Cold Calculator   | Pretends to be Stockfish. Is not.                          |

---

## 🚀 Quick start (pick a phase)

### Phase 1 — Python CLI

```bash
cd phase-1-cli
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Dry-run (no API keys needed)
python -m ai_chess_gladiator \
    --white dummy --white-persona overconfident \
    --black dummy --black-persona doomer \
    --name dry-run-001

# Real LLM match (ChatGPT vs. DeepSeek)
export OPENAI_API_KEY=sk-...
export DEEPSEEK_API_KEY=sk-...
python -m ai_chess_gladiator \
    --white openai   --white-model gpt-4o-mini   --white-persona overconfident \
    --black deepseek --black-model deepseek-chat --black-persona cheater \
    --name gpt-vs-deepseek-001
```

See [`phase-1-cli/README.phase-1.md`](./phase-1-cli/README.phase-1.md) for full docs.

### Phase 2 — Web MVP

```bash
cd phase-2-web
bun install

# DB setup
echo 'DATABASE_URL=file:./dev.db' > .env
bun run db:push

# Start the socket.io mini-service (real-time events)
cd mini-services/match-runner && bun install && bun run dev &  # port 3003
cd ../..

# Start the Next.js app
bun run dev   # port 3000

# Seed the AI gladiators
curl -X POST http://localhost:3000/api/seed
```

Open `http://localhost:3000`, schedule a match, place a bet, hit Start, watch the carnage.

See [`phase-2-web/README.phase-2.md`](./phase-2-web/README.phase-2.md) for full docs.

---

## 🏗️ Architecture (the big picture)

```
┌─────────────────────────────────────────────────────────────┐
│                       BotBrawl                              │
│                                                             │
│  ┌──────────────────┐         ┌──────────────────────┐     │
│  │  Phase 1: CLI    │         │  Phase 2: Web MVP    │     │
│  │  (Python)        │         │  (Next.js + socket)  │     │
│  │                  │         │                      │     │
│  │  • 4 LLM         │  ports  │  • 6 AI gladiators   │     │
│  │    providers     │ ◀────▶ │  • Real-time board   │     │
│  │  • 7 personas    │ shared  │  • Live trash talk   │     │
│  │  • JSONL logs    │  prompt │  • Token betting     │     │
│  │                  │  format │  • Elo leaderboard   │     │
│  └──────────────────┘         └──────────────────────┘     │
│              │                          │                   │
│              └──────────┬───────────────┘                   │
│                         ▼                                   │
│              ┌──────────────────────┐                       │
│              │  Phase 3: Clipping   │  (planned)            │
│              │  • Reads JSONL logs  │                       │
│              │  • Auto-extracts     │                       │
│              │    blunders          │                       │
│              │  • Renders shorts    │                       │
│              └──────────────────────┘                       │
│                         ▼                                   │
│              ┌──────────────────────┐                       │
│              │  Phase 4: Tournaments│  (planned)            │
│              │  • Bracket system    │                       │
│              │  • Livestream        │                       │
│              │  • User auth         │                       │
│              └──────────────────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

The two shipped phases share the same prompt format, persona catalog, and Elo formula — Phase 2 is a faithful TypeScript port of Phase 1's Python engine.

---

## 🧱 Tech stack at a glance

| Concern            | Phase 1 (CLI)          | Phase 2 (Web)                      |
|--------------------|------------------------|------------------------------------|
| Language           | Python 3.10+           | TypeScript 5                       |
| Chess engine       | `python-chess`         | `chess.js`                         |
| LLM backend        | OpenAI / Anthropic / Gemini / DeepSeek SDKs (direct) | `z-ai-web-dev-sdk` (unified)      |
| Real-time          | stdout                 | socket.io (port 3003)              |
| Persistence        | JSONL + .txt files     | Prisma + SQLite                    |
| UI                 | Terminal               | Next.js 16 + shadcn/ui             |
| Betting            | —                      | Virtual Compute Tokens (Elo-based payouts) |

---

## 🤝 Contributing

PRs welcome. The most useful early contributions:

- **More personas** — add them in both `phase-1-cli/ai_chess_gladiator/prompts.py` and `phase-2-web/src/lib/personas.ts` (they should stay in sync).
- **More LLM providers** — Phase 2 currently uses one backend (`z-ai-web-dev-sdk`); adding direct OpenAI / Anthropic / Gemini support would let users pick.
- **Phase 3 clipping pipeline** — read JSONL logs from Phase 1 and DB events from Phase 2, auto-extract "Blunder of the Week" candidates, render as vertical video.
- **Elo tracking improvements** — K-factor tuning, provisional ratings for new AIs, title thresholds.

---

## ⚠️ Disclaimer

This project is for entertainment. The LLMs will play *terrible* chess. That's the point. Don't bet real money on them. Don't let them drive your car. Don't ask them for stock tips.

---

## 📄 License

MIT — see [LICENSE](./LICENSE). Each phase subdirectory also has its own copy for convenience.
