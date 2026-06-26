// API route: receives client-side errors and writes them to ~/ebay-lister.log.
// Also supports GET to read the last N log lines (protected by APP_SECRET).

import { NextRequest, NextResponse } from "next/server";
import { logError } from "@/lib/logger";
import { guardApiRequest } from "@/lib/api-guard";
import { readFileSync, statSync } from "fs";
import { join } from "path";

const LOG_PATH = join(process.env.HOME || "/root", "ebay-lister.log");

export const dynamic = "force-dynamic";

// POST — client error reporter sends errors here (no auth needed, it's internal).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    logError("client", body.message || "Unknown client error", undefined, {
      source: body.source,
      line: body.line,
      col: body.col,
      stack: body.stack,
    });
  } catch {
    // swallow
  }
  return NextResponse.json({ ok: true });
}

// GET — read recent log entries (requires auth).
export async function GET(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  const lines = Number(req.nextUrl.searchParams.get("lines") || "100");

  try {
    const stat = statSync(LOG_PATH);
    if (stat.size === 0) {
      return NextResponse.json({ ok: true, entries: [], message: "Log is empty." });
    }

    const content = readFileSync(LOG_PATH, "utf-8");
    const allLines = content.trim().split("\n").filter(Boolean);
    const tail = allLines.slice(-Math.min(lines, 500));

    const entries = tail.map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { raw: line };
      }
    });

    return NextResponse.json({ ok: true, total: allLines.length, entries });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ ok: true, entries: [], message: "No log file yet." });
    }
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 }
    );
  }
}
