"""BotBrawl Phase 3 — Clipping pipeline.

Two entry points:

  python -m botbrawl_clipping.detect    -- Scan completed matches for blunders
  python -m botbrawl_clipping.render    -- Render a highlight as a vertical MP4

Both scripts read/write the same SQLite DB that the Phase 2 Next.js app uses
(via Prisma). We talk to it directly with sqlite3 to avoid a Prisma Python
client — fewer moving parts.
"""

__version__ = "0.1.0"
