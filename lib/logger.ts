// Server-side structured logger.
// Writes JSON lines to ~/ebay-lister.log so errors survive across restarts.
// Each line: {"ts":"ISO","level":"error|warn|info","route":"/api/...","message":"...","stack":"...","meta":{...}}

import { appendFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";

const LOG_PATH = join(process.env.HOME || "/root", "ebay-lister.log");

// Ensure the directory exists (covers edge cases with HOME).
try {
  mkdirSync(dirname(LOG_PATH), { recursive: true });
} catch {
  // ignore
}

interface LogEntry {
  ts: string;
  level: "error" | "warn" | "info";
  route: string;
  message: string;
  stack?: string;
  meta?: Record<string, unknown>;
}

function write(entry: LogEntry): void {
  try {
    appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
  } catch {
    // Can't log the logger — just swallow.
  }
}

export function logError(
  route: string,
  message: string,
  err?: unknown,
  meta?: Record<string, unknown>
): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level: "error",
    route,
    message,
    stack: err instanceof Error ? err.stack : undefined,
    meta,
  };
  write(entry);
  // Also echo to stderr so it shows in `next start` output.
  console.error(`[${route}] ${message}`, err ?? "");
}

export function logWarn(
  route: string,
  message: string,
  meta?: Record<string, unknown>
): void {
  write({ ts: new Date().toISOString(), level: "warn", route, message, meta });
}

export function logInfo(
  route: string,
  message: string,
  meta?: Record<string, unknown>
): void {
  write({ ts: new Date().toISOString(), level: "info", route, message, meta });
}
