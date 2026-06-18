"""Highlight renderer — turns a Highlight row into a 9:16 vertical MP4 clip.

The clip is a short (5-second) vertical video showing:
  - Top:    BotBrawl branding + AI player name + persona
  - Middle: The chessboard at the moment of the blunder, with last-move highlight
  - Bottom: The AI's monologue as a subtitle + blunder score badge

Frames are rendered with python-chess's SVG board + cairosvg → PNG, then
composited with Pillow (text overlay, branding), then stitched into an MP4
with ffmpeg.

Usage:
    python -m botbrawl_clipping.render --db /path/to/custom.db --highlight-id <id>
    python -m botbrawl_clipping.render --db /path/to/custom.db --all
"""

from __future__ import annotations

import argparse
import io
import os
import secrets
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Optional

import cairosvg
import chess
import chess.svg
from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# 9:16 vertical, 1080x1920 (TikTok / YouTube Shorts standard)
FRAME_W = 1080
FRAME_H = 1920

# Layout regions (y-coordinates)
HEADER_H = 280
BOARD_AREA_Y = HEADER_H
BOARD_AREA_H = 1080       # square board, padded
MONOLOGUE_Y = BOARD_AREA_Y + BOARD_AREA_H + 40
MONOLOGUE_H = FRAME_H - MONOLOGUE_Y - 60

# Colors — BotBrawl dark theme
BG_COLOR = (12, 14, 22)           # near-black
ACCENT_COLOR = (255, 80, 80)      # red — for the blunder score
WHITE_PIECE = (245, 245, 245)
BLACK_PIECE = (30, 30, 30)
HIGHLIGHT_COLOR = (255, 230, 80)  # yellow — for last-move square

# Output directory — this is INSIDE the Next.js public/ folder so the MP4
# is served as a static asset at /highlights/<filename>.
# Resolved relative to the project root at runtime.
DEFAULT_OUTPUT_DIR = "/home/z/my-project/public/highlights"

# Fonts — try Noto Sans SC first (CJK + Latin), fall back to DejaVu.
FONT_PATHS = [
    "/usr/share/fonts/truetype/chinese/NotoSansSC[wght].ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]

# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def fetch_highlight(conn: sqlite3.Connection, highlight_id: str) -> Optional[sqlite3.Row]:
    return conn.execute(
        """
        SELECT h.*, m.whiteId, m.blackId,
               w.name AS white_name, w.personaKey AS white_persona,
               b.name AS black_name, b.personaKey AS black_persona,
               m.winner, m.reason
        FROM Highlight h
        JOIN Match m ON m.id = h.matchId
        JOIN AIPlayer w ON w.id = m.whiteId
        JOIN AIPlayer b ON b.id = m.blackId
        WHERE h.id = ?
        """,
        (highlight_id,),
    ).fetchone()


def fetch_pending_highlights(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute(
        """
        SELECT h.*, w.name AS white_name, w.personaKey AS white_persona,
               b.name AS black_name, b.personaKey AS black_persona,
               m.winner, m.reason
        FROM Highlight h
        JOIN Match m ON m.id = h.matchId
        JOIN AIPlayer w ON w.id = m.whiteId
        JOIN AIPlayer b ON b.id = m.blackId
        WHERE h.status = 'PENDING'
        ORDER BY h.blunderScore DESC
        """
    ).fetchall()


def update_highlight_status(conn: sqlite3.Connection, highlight_id: str,
                            status: str, video_path: str | None = None) -> None:
    if video_path:
        # Prisma stores SQLite DateTime as INTEGER milliseconds since epoch
        rendered_at_ms = int(time.time() * 1000)
        conn.execute(
            """
            UPDATE Highlight
            SET status = ?, videoPath = ?, renderedAt = ?
            WHERE id = ?
            """,
            (status, video_path, rendered_at_ms, highlight_id),
        )
    else:
        conn.execute(
            "UPDATE Highlight SET status = ? WHERE id = ?",
            (status, highlight_id),
        )
    conn.commit()


# ---------------------------------------------------------------------------
# Font helpers
# ---------------------------------------------------------------------------

_font_cache: dict[int, ImageFont.FreeTypeFont] = {}


def get_font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont:
    key = (size, bold)
    if key in _font_cache:
        return _font_cache[key]
    paths = FONT_PATHS if bold else list(reversed(FONT_PATHS))
    for p in paths:
        if os.path.exists(p):
            try:
                font = ImageFont.truetype(p, size)
                _font_cache[key] = font
                return font
            except Exception:
                continue
    # Last resort — default bitmap font
    font = ImageFont.load_default()
    _font_cache[key] = font
    return font


def text_size(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont) -> tuple[int, int]:
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0], bbox[3] - bbox[1]


def wrap_text(text: str, font: ImageFont.FreeTypeFont, draw: ImageDraw.ImageDraw,
              max_width: int) -> list[str]:
    """Greedy word-wrap that respects max_width."""
    words = text.split()
    if not words:
        return []
    lines: list[str] = []
    current = words[0]
    for w in words[1:]:
        candidate = current + " " + w
        w_px, _ = text_size(draw, candidate, font)
        if w_px <= max_width:
            current = candidate
        else:
            lines.append(current)
            current = w
    lines.append(current)
    return lines


# ---------------------------------------------------------------------------
# Frame rendering
# ---------------------------------------------------------------------------

PERSONA_LABELS = {
    "apologetic": "The Apologetic Strategist",
    "overconfident": "The Delusional Grandmaster",
    "cheater": "The Rules Lawyer",
    "philosopher": "The Chess Philosopher",
    "streamer": "The Hype Streamer",
    "doomer": "The Doomer",
    "robot": "The Cold Calculator",
}

BLUNDER_LABELS = {
    "RESIGNATION": "GAVE UP",
    "TIMEOUT": "FROZE",
    "ILLEGAL_RETRIES": "ILLEGAL MOVES",
    "ILLEGAL_ATTEMPT": "ILLEGAL MOVE",
    "MATERIAL_LOSS": "BLUNDERED MATERIAL",
}


def render_board_png(fen: str, last_move_uci: str | None = None,
                     size: int = 1000) -> bytes:
    """Render a chess board as PNG bytes via python-chess SVG → cairosvg."""
    board = chess.Board(fen)
    # Pull the last move so we can highlight it
    last_move = None
    if last_move_uci:
        try:
            last_move = chess.Move.from_uci(last_move_uci)
        except (chess.InvalidMoveError, ValueError):
            last_move = None

    svg_data = chess.svg.board(
        board,
        lastmove=last_move,
        size=size,
        colors={"square light": "#f0d9b5", "square dark": "#b58863",
                "margin": "#1a1a1a"},
        coordinates=True,
    )
    png_bytes = cairosvg.svg2png(bytestring=svg_data.encode("utf-8"),
                                 output_width=size, output_height=size)
    return png_bytes


def render_frame(highlight: sqlite3.Row, frame_idx: int, total_frames: int) -> Image.Image:
    """Render one vertical 1080x1920 frame for the highlight."""
    img = Image.new("RGB", (FRAME_W, FRAME_H), BG_COLOR)
    draw = ImageDraw.Draw(img)

    # ----- HEADER (top 280px) -----
    # BotBrawl wordmark
    wm_font = get_font(72, bold=True)
    wm_text = "🤖 BotBrawl"
    wm_w, _ = text_size(draw, wm_text, wm_font)
    draw.text(((FRAME_W - wm_w) // 2, 50), wm_text, font=wm_font, fill=(255, 255, 255))

    # Subtitle
    sub_font = get_font(32, bold=False)
    sub_text = "Where AI models fight, fail, and get famous"
    sub_w, _ = text_size(draw, sub_text, sub_font)
    draw.text(((FRAME_W - sub_w) // 2, 140), sub_text, font=sub_font, fill=(160, 160, 170))

    # Player name + persona
    side = highlight["side"]
    if side == "white":
        player_name = highlight["white_name"]
        persona_key = highlight["white_persona"]
    else:
        player_name = highlight["black_name"]
        persona_key = highlight["black_persona"]
    persona_label = PERSONA_LABELS.get(persona_key, persona_key)

    player_font = get_font(44, bold=True)
    player_text = f"{player_name} ({side.upper()})"
    pw, _ = text_size(draw, player_text, player_font)
    draw.text(((FRAME_W - pw) // 2, 200), player_text, font=player_font,
              fill=ACCENT_COLOR)

    # ----- BOARD AREA (middle 1080px) -----
    # Figure out the last move UCI for highlighting
    fen_before = highlight["fenBefore"]
    fen_after = highlight["fenAfter"]
    last_move_uci = None
    if fen_after and highlight["san"]:
        # Reconstruct the UCI move by replaying
        try:
            board_before = chess.Board(fen_before)
            move = board_before.parse_san(highlight["san"])
            last_move_uci = move.uci()
        except Exception:
            last_move_uci = None

    # If the blunder is a resignation/timeout, just show the fen_before
    fen_to_render = fen_after if fen_after else fen_before
    board_png = render_board_png(fen_to_render, last_move_uci, size=1000)
    board_img = Image.open(io.BytesIO(board_png))
    # Paste centered in the board area
    bx = (FRAME_W - 1000) // 2
    by = BOARD_AREA_Y + 40
    img.paste(board_img, (bx, by))

    # ----- BLUNDER SCORE BADGE (right of board, top-right of frame) -----
    score = highlight["blunderScore"]
    badge_font = get_font(28, bold=True)
    badge_text = f"FAIL SCORE {score}/100"
    bw, bh = text_size(draw, badge_text, badge_font)
    badge_x = FRAME_W - bw - 40
    badge_y = BOARD_AREA_Y + 10
    # Rounded rect background
    draw.rounded_rectangle(
        [badge_x - 16, badge_y - 8, badge_x + bw + 16, badge_y + bh + 8],
        radius=12, fill=ACCENT_COLOR,
    )
    draw.text((badge_x, badge_y), badge_text, font=badge_font, fill=(255, 255, 255))

    # ----- BLUNDER TYPE LABEL (left of board) -----
    btype_label = BLUNDER_LABELS.get(highlight["blunderType"], highlight["blunderType"])
    btype_font = get_font(28, bold=True)
    btype_w, btype_h = text_size(draw, btype_label, btype_font)
    btype_x = 40
    btype_y = BOARD_AREA_Y + 10
    draw.rounded_rectangle(
        [btype_x - 16, btype_y - 8, btype_x + btype_w + 16, btype_y + btype_h + 8],
        radius=12, outline=ACCENT_COLOR, width=3,
    )
    draw.text((btype_x, btype_y), btype_label, font=btype_font, fill=ACCENT_COLOR)

    # ----- MONOLOGUE (bottom area) -----
    mono_text = highlight["monologue"] or "(no comment from the AI)"
    # Cap at 280 chars so we don't overflow
    if len(mono_text) > 280:
        mono_text = mono_text[:277] + "..."

    mono_font = get_font(36, bold=False)
    max_w = FRAME_W - 80
    lines = wrap_text(mono_text, mono_font, draw, max_w)
    # Cap at 6 lines
    if len(lines) > 6:
        lines = lines[:6]
        lines[-1] = lines[-1][:-3] + "..."

    # Render lines centered, anchored to top of monologue area
    line_h = 50
    total_h = line_h * len(lines)
    start_y = MONOLOGUE_Y + (MONOLOGUE_H - total_h) // 2
    for i, line in enumerate(lines):
        lw, _ = text_size(draw, line, mono_font)
        draw.text(((FRAME_W - lw) // 2, start_y + i * line_h), line,
                  font=mono_font, fill=(240, 240, 245))

    # ----- SUBTITLE BAND (very bottom — clip title + match link) -----
    title_font = get_font(30, bold=True)
    title_text = highlight["title"]
    tw, _ = text_size(draw, title_text, title_font)
    draw.text(((FRAME_W - tw) // 2, FRAME_H - 80), title_text,
              font=title_font, fill=(255, 255, 255))

    # ----- ENTRANCE ANIMATION -----
    # On the first ~25% of frames, fade the board in from black with a slight
    # zoom. This gives the clip a "dun dun DUN" reveal feel.
    progress = frame_idx / max(1, total_frames - 1)
    if progress < 0.25:
        # Fade-in: overlay a black rect with alpha = (1 - progress*4) * 255
        alpha = int((1 - progress * 4) * 255)
        overlay = Image.new("RGB", (FRAME_W, FRAME_H), (0, 0, 0))
        # Use composite with alpha — convert overlay to RGBA
        overlay_rgba = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, alpha))
        img_rgba = img.convert("RGBA")
        img_rgba = Image.alpha_composite(img_rgba, overlay_rgba)
        img = img_rgba.convert("RGB")

    # Pulse the score badge on the last 20% of frames (the "drama" moment)
    if progress > 0.8:
        pulse = (progress - 0.8) / 0.2
        # Just re-draw the badge slightly larger with a glow
        scale = 1 + 0.05 * pulse
        sw, sh = int(bw * scale), int(bh * scale)
        sx = FRAME_W - sw - 40
        sy = BOARD_AREA_Y + 10 - (sh - bh) // 2
        draw.rectangle(
            [sx - 16, sy - 8, sx + sw + 16, sy + sh + 8],
            fill=ACCENT_COLOR,
        )
        draw.text((sx, sy), badge_text, font=badge_font, fill=(255, 255, 255))

    return img


# ---------------------------------------------------------------------------
# Video assembly via ffmpeg
# ---------------------------------------------------------------------------

def render_clip(highlight: sqlite3.Row, output_dir: str) -> str:
    """Render the full clip. Returns the relative path under /public/."""
    os.makedirs(output_dir, exist_ok=True)

    # Generate frames into a temp dir
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        total_frames = 30  # 30 frames at 5fps = 6 seconds
        for i in range(total_frames):
            frame = render_frame(highlight, i, total_frames)
            frame.save(tmp_path / f"frame-{i:04d}.png", "PNG")

        # Stitch into MP4 with ffmpeg
        # -framerate 5 → 5fps input
        # -c:v libx264 → H.264 codec (TikTok-compatible)
        # -pix_fmt yuv420p → broadly compatible pixel format
        # -movflags +faststart → web-friendly streaming
        clip_id = secrets.token_hex(8)
        out_filename = f"highlight-{highlight['id'][:12]}-{clip_id}.mp4"
        out_path = os.path.join(output_dir, out_filename)

        cmd = [
            "ffmpeg", "-y",
            "-framerate", "5",
            "-i", str(tmp_path / "frame-%04d.png"),
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            "-vf", "scale=1080:1920",
            str(out_path),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg failed: {result.stderr[-500:]}")

    # The videoPath stored in DB is relative to /public so the Next.js app
    # can serve it directly. Strip the public/ prefix.
    public_dir = "/home/z/my-project/public"
    if out_path.startswith(public_dir + "/"):
        rel_path = out_path[len(public_dir) + 1:]
    else:
        rel_path = out_path
    return rel_path


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description="Render BotBrawl highlights as vertical MP4 clips.")
    parser.add_argument("--db", required=True, help="Path to the SQLite database file")
    parser.add_argument("--highlight-id", default=None, help="Render this specific highlight")
    parser.add_argument("--all", action="store_true", help="Render all PENDING highlights")
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR,
                        help=f"Output directory for MP4s (default: {DEFAULT_OUTPUT_DIR})")
    args = parser.parse_args()

    if not args.highlight_id and not args.all:
        parser.error("Specify --highlight-id <id> or --all")

    conn = connect(args.db)
    try:
        if args.highlight_id:
            rows = [fetch_highlight(conn, args.highlight_id)]
            if not rows[0]:
                print(f"Highlight {args.highlight_id} not found.", file=sys.stderr)
                return 1
        else:
            rows = fetch_pending_highlights(conn)

        if not rows:
            print("No highlights to render.")
            return 0

        succeeded = 0
        failed = 0
        for row in rows:
            hid = row["id"]
            title = row["title"]
            print(f"\n→ Rendering [{hid[:8]}] {title} (score {row['blunderScore']})")
            update_highlight_status(conn, hid, "RENDERING")
            try:
                rel_path = render_clip(row, args.output_dir)
                update_highlight_status(conn, hid, "RENDERED", video_path=rel_path)
                print(f"  ✓ Saved to /public/{rel_path}")
                succeeded += 1
            except Exception as e:
                update_highlight_status(conn, hid, "FAILED")
                print(f"  ✗ Failed: {e}", file=sys.stderr)
                failed += 1

        print(f"\nDone. {succeeded} rendered, {failed} failed.")
        return 0 if failed == 0 else 1
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
