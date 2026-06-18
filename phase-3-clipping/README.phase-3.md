# 🎬 BotBrawl Phase 3 — Clipping Pipeline

> Auto-detect the funniest AI blunders. Render them as 9:16 vertical MP4 clips for TikTok, YouTube Shorts, and Instagram Reels.

Phase 3 turns the chaos from completed BotBrawl matches into shareable short-form video. The pipeline is two Python scripts:

1. **`detect.py`** — scans completed matches in the SQLite DB, scores each event by "funny fail" potential (resignations, illegal-move retries, material losses, timeouts), and inserts the top candidates into the `Highlight` table.
2. **`render.py`** — turns a `Highlight` row into a 6-second 1080×1920 vertical MP4 with the chessboard at the moment of the blunder, the AI's monologue as a subtitle, BotBrawl branding, and a FAIL score badge.

Both scripts read/write the **same SQLite DB** the Phase 2 Next.js app uses, so the web UI can trigger detection and rendering via HTTP.

---

## 📋 Requirements

- Python 3.10+
- `ffmpeg` (for video stitching)
- Python packages: `python-chess`, `matplotlib`, `Pillow`, `cairosvg`

```bash
pip install -r requirements.txt
```

You also need the BotBrawl SQLite database (created by Phase 2's Prisma setup). The scripts default to `/home/z/my-project/db/custom.db` but accept `--db /path/to/your.db` to override.

---

## 🚀 Usage

### Scan a match (or all matches) for blunders

```bash
# Scan all completed matches
python -m botbrawl_clipping.detect --db /path/to/custom.db

# Scan one specific match
python -m botbrawl_clipping.detect --db /path/to/custom.db --match-id <matchId>
```

Output:

```
  [cmqi9k09] GPT-Rook vs Claude-Knight: 2 highlight(s) added

Done. 2 highlight(s) inserted across 1 match(es).
```

### Render highlights as MP4 clips

```bash
# Render one specific highlight
python -m botbrawl_clipping.render --db /path/to/custom.db --highlight-id <highlightId>

# Render all PENDING highlights (highest-scored first)
python -m botbrawl_clipping.render --db /path/to/custom.db --all

# Use a custom output directory
python -m botbrawl_clipping.render --db /path/to/custom.db --all --output-dir /var/www/public/highlights
```

Output:

```
→ Rendering [7eb1f936] Claude-Knight GIVES UP mid-game 🏳️ (score 70)
  ✓ Saved to /public/highlights/highlight-7eb1f9366280-22935a6f8c912bd3.mp4

Done. 1 rendered, 0 failed.
```

The MP4 is written to `--output-dir` (default: `/home/z/my-project/public/highlights/`), and the DB row's `videoPath` and `status` fields are updated so the Phase 2 web UI can serve and display it.

---

## 🎯 Blunder scoring heuristic

| Event type           | Base score | Bonus                            | Example                                  |
|----------------------|------------|----------------------------------|------------------------------------------|
| `player_resigned`    | +60        | +10 per retry (max +30)          | "exhausted 3 retries and resigns"        |
| `player_timeout`     | +50        | —                                | AI froze for 30s                         |
| `move` + 3+ retries  | +40        | +10 per retry over 3 (max +30)   | "tried 3 ILLEGAL moves in a row"         |
| `move` + 1–2 retries | +15        | +5 per retry                     | "tried an illegal move: confusion.exe"   |
| `move` + material loss | +5/point | capped at +40                    | "blundered material on Qxd8"             |
| Any event + API error | —         | +5 per error (max +10)           | Rate-limited mid-thought                 |

Final score is clamped to 0–100. Events scoring below 20 are skipped (not funny enough).

---

## 🎨 Video format

- **Resolution**: 1080×1920 (9:16 vertical — TikTok / YouTube Shorts / Instagram Reels standard)
- **Duration**: 6 seconds (30 frames at 5 fps)
- **Codec**: H.264, `yuv420p` pixel format, `+faststart` for web streaming
- **Layout** (top to bottom):
  - **Header** (280px): 🤖 BotBrawl wordmark + tagline + AI player name
  - **Board** (1000×1000): chessboard with last-move highlight, surrounded by:
    - Top-left: blunder type label (e.g., "GAVE UP", "ILLEGAL MOVES")
    - Top-right: red "FAIL SCORE 70/100" badge
  - **Monologue** (~340px): the AI's in-character narration, word-wrapped and centered
  - **Footer** (80px): auto-generated clickbait title
- **Animation**: 0.75s fade-in from black on the first 25% of frames; FAIL score badge pulses on the last 20% (the "drama" moment)

---

## 🔌 Integration with Phase 2

The Phase 2 Next.js app talks to these scripts via `src/lib/clipping-runner.ts`, which shells out to `python3 -m botbrawl_clipping.<module>` from this directory. The relevant API routes:

| Method | Endpoint                       | What it does                                   |
|--------|--------------------------------|------------------------------------------------|
| GET    | `/api/highlights`              | List highlights (optional `?matchId=` filter)  |
| POST   | `/api/highlights`              | Run the detector (optional `{ matchId }` body) |
| GET    | `/api/highlights/[id]`         | Get one highlight                              |
| POST   | `/api/highlights/[id]/render`  | Trigger rendering for one highlight            |

The web UI's **Highlights** tab lets users:
1. Click **Scan for Blunders** → runs the detector on all completed matches
2. See a grid of blunder cards with FAIL score badges + AI monologue previews
3. Click **Render** on any card → triggers MP4 generation
4. Once rendered, the inline `<video>` player lets them watch (and download) the clip

---

## 🗂️ File layout

```
phase-3-clipping/
├── README.phase-3.md             ← this file
├── requirements.txt
├── botbrawl_clipping/
│   ├── __init__.py
│   ├── detect.py                 ← blunder detector (CLI: python -m botbrawl_clipping.detect)
│   └── render.py                 ← MP4 renderer   (CLI: python -m botbrawl_clipping.render)
├── output/                       ← (gitkeep) rendered MP4s go here by default
└── frames/                       ← (gitkeep) intermediate frame PNGs (cleaned up after each render)
```

The default `--output-dir` is `/home/z/my-project/public/highlights/` (inside the Next.js `public/` folder) so the MP4s are served as static assets at `/highlights/<filename>.mp4`. Override with `--output-dir` if your layout differs.

---

## 🔮 What's NOT here (future work)

- **Auto-upload to YouTube/TikTok/Instagram** — requires OAuth flows, API credentials, content moderation. Planned for late Phase 3 / early Phase 4.
- **TTS narration of the AI monologue** — the current clips are silent (subtitles only). Adding z-ai-web-dev-sdk TTS would let the AI's voice actually say its monologue. ~1 day of work.
- **Stockfish-powered blunder scoring** — the current heuristic uses retries + material loss. A real Stockfish eval diff (`?eval before - ?eval after`) would catch positional blunders that don't lose material. Requires `python-chess` + a Stockfish binary.
- **Submission queue** — for a real "Blunder of the Week" series, you'd want a human-in-the-loop review step where 5 candidates are scored and the best one is scheduled for posting. This is a Phase 4 feature.
