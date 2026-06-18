# ♟️ AI Chess Gladiator — Web MVP (Phase 2)

> Watch LLMs play chess badly. Bet virtual Compute Tokens on the winner. Live, in your browser.

This is the **Phase 2 web MVP** of AI Chess Gladiator — a real-time arena where large language models (powered by the z-ai-web-dev-sdk) play chess against each other, trash-talk, hallucinate, and resign in disgrace. Users schedule matches, place bets with virtual Compute Tokens, watch the action live with a side-by-side board + AI monologue stream, and track the Elo leaderboard.

Phase 1 (the Python CLI prototype) lives in a separate repo: [`ai-chess-gladiator`](https://github.com/xxnavdeep07xx-droid/ai-chess-gladiator).

---

## ✨ What's in Phase 2

### Four-tab single-page app

- **Matches** — schedule new AI-vs-AI duels (pick any 2 of 6 seeded gladiators), see live/upcoming/completed matches with betting pool bars
- **Arena** — SVG chessboard with last-move highlighting, side-by-side **Live AI Trash Talk** panel showing per-move monologues with timestamps + SAN moves, bid form with quick-amount buttons and live payout multiplier
- **Leaderboard** — 6 AI players ranked by Elo with persona badges (👑 Grandmaster at top, Woodpusher at bottom), W/L/D, win rate
- **My Bets** — token balance, total wagered, net profit, win rate, full bet history with status badges (WON/LOST/PENDING)

### Core systems

- **Match engine** (`src/lib/chess-engine.ts`) — TypeScript port of Phase 1's Python engine: `chess.js`-backed match loop, illegal-move retry policy (3 retries before resignation), all terminal conditions (checkmate / stalemate / insufficient material / threefold repetition / 50-move rule), per-move timeout
- **LLM player adapter** (`src/lib/llm-player.ts`) — uses `z-ai-web-dev-sdk` to power the AI gladiators; same prompt format as Phase 1
- **Persona catalog** (`src/lib/personas.ts`) — 7 trash-talk personas: The Delusional Grandmaster, The Apologetic Strategist, The Rules Lawyer, The Chess Philosopher, The Hype Streamer, The Doomer, The Cold Calculator
- **Elo + payouts** (`src/lib/elo.ts`) — standard Elo (K=32), payout multipliers derived from win probability (clamped 1.1×–8.0×)
- **Real-time streaming** — a `socket.io` mini-service on port 3003 fans events from the API route to all subscribed browser clients

---

## 🏗️ Tech stack

- **Framework**: Next.js 16 (App Router) + TypeScript 5
- **Styling**: Tailwind CSS 4 + shadcn/ui (New York) + Lucide icons
- **Database**: Prisma ORM + SQLite
- **Real-time**: socket.io (mini-service on port 3003)
- **State**: TanStack Query (server) + Zustand-ready (client)
- **Chess engine**: `chess.js`
- **LLM backend**: `z-ai-web-dev-sdk` (server-side only)

---

## 📁 Project structure

```
.
├── prisma/
│   └── schema.prisma              # User, AIPlayer, Match, MatchEvent, Bet
├── src/
│   ├── app/
│   │   ├── layout.tsx             # Root layout + providers
│   │   ├── page.tsx               # Single-page app with 4 tabs
│   │   ├── globals.css
│   │   └── api/
│   │       ├── leaderboard/route.ts
│   │       ├── matches/route.ts                # GET list, POST create
│   │       ├── matches/[id]/route.ts           # GET detail
│   │       ├── matches/[id]/start/route.ts     # POST — kicks off the runner
│   │       ├── user/route.ts                   # GET current user + bets
│   │       ├── bets/route.ts                   # GET/POST bets
│   │       └── seed/route.ts                   # POST — idempotent seeding
│   ├── components/
│   │   ├── arena-view.tsx         # Live match viewer (board + chat + bids)
│   │   ├── chat-panel.tsx         # Streaming AI monologue panel
│   │   ├── chess-board.tsx        # SVG chessboard with last-move highlight
│   │   ├── leaderboard-table.tsx
│   │   ├── match-card.tsx
│   │   ├── bid-form.tsx           # Wager UI with live payout calc
│   │   ├── create-match-dialog.tsx
│   │   ├── upcoming-view.tsx
│   │   ├── my-bets-view.tsx
│   │   ├── providers.tsx          # QueryClientProvider wrapper
│   │   └── ui/                    # shadcn/ui components
│   ├── lib/
│   │   ├── db.ts                  # Prisma client singleton
│   │   ├── personas.ts            # 7 trash-talk personas + system-prompt builder
│   │   ├── chess-engine.ts        # Match runner (illegal retries, terminal conditions)
│   │   ├── llm-player.ts          # z-ai-web-dev-sdk adapter
│   │   ├── elo.ts                 # Elo update + payout multiplier
│   │   └── socket.ts              # socket.io client helper
│   └── hooks/
├── mini-services/
│   └── match-runner/
│       ├── index.ts               # socket.io service on port 3003
│       └── package.json
├── package.json
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
├── postcss.config.mjs
├── eslint.config.mjs
├── components.json                # shadcn/ui config
└── prisma/schema.prisma
```

---

## 🚀 Quick start

### 1. Install dependencies

```bash
git clone https://github.com/xxnavdeep07xx-droid/ai-chess-gladiator-web.git
cd ai-chess-gladiator-web
bun install
```

### 2. Set up the database

```bash
# Create a .env file with the SQLite path
echo 'DATABASE_URL=file:./dev.db' > .env

# Push the Prisma schema + generate the client
bun run db:push
```

### 3. Seed the AI gladiators

```bash
# After starting the dev server (next step), hit the seed endpoint:
curl -X POST http://localhost:3000/api/seed
```

This creates 6 AI players (GPT-Rook, Claude-Knight, Gemini-Bishop, DeepSeek-Queen, Llama-Pawn, Mistral-King), each with a different persona, plus a demo user with 1,000 Compute Tokens.

### 4. Start the socket.io mini-service

```bash
cd mini-services/match-runner
bun install
bun run dev   # listens on port 3003
```

### 5. Start the Next.js dev server

```bash
# From the project root
bun run dev   # listens on port 3000
```

Open `http://localhost:3000` and you should see the AI Chess Gladiator UI.

---

## 🎮 How to use it

1. **Schedule a match** — On the **Matches** tab, click *Schedule Match*, pick a White and Black player, click *Schedule*.
2. **Place a bet** — On the Arena view for the new match, pick a side, enter a token amount, click *Bet*. Payouts are higher for underdogs (lower Elo).
3. **Start the match** — Click *Start Match*. The LLM-vs-LLM runner kicks off; moves stream into the chat panel in real time.
4. **Watch the chaos** — Each AI narrates its thought process in character before every move. Illegal moves get retried up to 3 times before forced resignation.
5. **Check results** — The Leaderboard updates Elo after every match; My Bets shows your full betting history with P/L.

---

## 🗺️ Roadmap

- [x] **Phase 1** — Python CLI prototype (two AIs play in the terminal, JSONL + readable logs)
- [x] **Phase 2** — Web MVP (this repo): real-time board + chat UI, virtual token betting, Elo leaderboard
- [ ] **Phase 3** — Content launch: automated clipping pipeline for "Blunder of the Week" YouTube/TikTok shorts
- [ ] **Phase 4** — Live tournaments: bracket system, livestream integration, public user registration + auth

---

## 🔌 API reference

| Method | Endpoint                          | Purpose                                              |
|--------|-----------------------------------|------------------------------------------------------|
| GET    | `/api/leaderboard`                | All AI players ranked by Elo                         |
| GET    | `/api/matches?status=UPCOMING`    | List matches (optional status filter)                |
| POST   | `/api/matches`                    | Schedule a new match `{ whiteId, blackId }`          |
| GET    | `/api/matches/[id]`               | Match detail with events + bets                      |
| POST   | `/api/matches/[id]/start`         | Flip to LIVE and kick off the async runner           |
| GET    | `/api/user`                       | Current user + token balance + bet history           |
| POST   | `/api/bets`                       | Place a bet `{ matchId, side, amount }`              |
| POST   | `/api/seed`                       | Idempotently seed AI players + demo user             |

### WebSocket events

Connect to `socket.io` on the same host (port 3003 via the gateway), then:

- **Emit** `subscribe_match` with a `matchId` to join that match's room
- **Listen** for `match_event` — every move, resignation, timeout, and match end
- **Emit** `unsubscribe_match` to leave

---

## ⚠️ Notes & caveats

- **Single demo user** — Phase 2 uses one shared demo user (email `demo@aichessgladiator.gg`) auto-created on first request. Real multi-user auth lands in Phase 4.
- **Daily token grant** — If your balance is below 1,000 when you load the page and it's been >24h since your last grant, it tops up to 1,000.
- **LLM rate limits** — The AIs are powered by `z-ai-web-dev-sdk`. Rapid match starts can hit rate limits; matches will retry up to 3 times per move on transient errors before resigning.
- **In-memory match runner** — The runner lives in the Next.js API route's process. If the server restarts mid-match, the match will be marked COMPLETED with an "Internal error" reason. A proper queue (BullMQ / Redis) is a Phase 4 task.

---

## 📄 License

MIT — see [LICENSE](LICENSE).
