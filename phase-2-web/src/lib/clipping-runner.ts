/**
 * Clipping runner — wraps the Phase 3 Python scripts (detect + render) as
 * typed async functions.
 *
 * The Python scripts live in /home/z/my-project/botbrawl/phase-3-clipping/
 * and are invoked via `python3 -m botbrawl_clipping.<module>` from that dir.
 *
 * Both scripts take `--db` pointing at the shared SQLite DB.
 */

import { exec } from "child_process";
import { promisify } from "util";
import path from "path";

const execAsync = promisify(exec);

const PHASE_3_DIR = "/home/z/my-project/botbrawl/phase-3-clipping";
const DB_PATH = "/home/z/my-project/db/custom.db";
const OUTPUT_DIR = "/home/z/my-project/public/highlights";

export interface DetectionResult {
  inserted: number;
  stdout: string;
}

/**
 * Run the blunder detector on all completed matches (or one specific match).
 * Resolves when the Python script exits.
 */
export async function execDetected(matchId?: string): Promise<DetectionResult> {
  const args = [
    "python3", "-m", "botbrawl_clipping.detect",
    "--db", DB_PATH,
  ];
  if (matchId) args.push("--match-id", matchId);

  const { stdout } = await execAsync(args.join(" "), {
    cwd: PHASE_3_DIR,
    timeout: 60_000,
  });

  // Parse the "Done. N highlight(s) inserted across M match(es)." line
  const match = stdout.match(/(\d+) highlight\(s\) inserted/);
  const inserted = match ? parseInt(match[1], 10) : 0;

  return { inserted, stdout };
}

/**
 * Run the renderer on one specific highlight. Resolves when the MP4 is done.
 */
export async function execRender(highlightId: string): Promise<{ videoPath: string | null }> {
  const args = [
    "python3", "-m", "botbrawl_clipping.render",
    "--db", DB_PATH,
    "--highlight-id", highlightId,
    "--output-dir", OUTPUT_DIR,
  ];

  const { stdout } = await execAsync(args.join(" "), {
    cwd: PHASE_3_DIR,
    timeout: 90_000,
  });

  // Parse "/public/<path>" from stdout
  const m = stdout.match(/Saved to \/public\/(\S+)/);
  return { videoPath: m ? m[1] : null };
}
