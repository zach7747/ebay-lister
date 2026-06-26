// Encrypted eBay connection stored SERVER-SIDE (not in cookies).
//
// The sealed token is written to ~/ebay-lister-connection so it survives
// across browsers and devices. Any device hitting the app shares the same
// eBay account connection.
//
// Cookies are still set as a fallback but the server file is authoritative.

import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { refreshAccessToken } from "./oauth";
import { logError, logInfo } from "@/lib/logger";

export const EBAY_COOKIE = "ebay_conn";
export const EBAY_STATE_COOKIE = "ebay_oauth_state";
export const EBAY_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

const CONNECTION_FILE = join(
  process.env.HOME || "/root",
  "ebay-lister-connection"
);

interface Connection {
  refreshToken: string;
  refreshExpiresAt: number; // epoch ms
}

// ── Encryption ───────────────────────────────────────────────────────────

async function aesKey(): Promise<CryptoKey> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not set. Add it in .env.local.");
  }
  if (secret.length < 32) {
    throw new Error(
      'SESSION_SECRET must be at least 32 characters. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret)
  );
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function sealConnection(conn: Connection): Promise<string> {
  const key = await aesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(conn));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data)
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return Buffer.from(out).toString("base64url");
}

export async function openConnection(
  sealed: string | undefined
): Promise<Connection | null> {
  if (!sealed) return null;
  try {
    const raw = Buffer.from(sealed, "base64url");
    const iv = raw.subarray(0, 12);
    const ct = raw.subarray(12);
    const key = await aesKey();
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    const conn = JSON.parse(new TextDecoder().decode(pt)) as Connection;
    if (!conn.refreshToken) return null;
    if (conn.refreshExpiresAt && conn.refreshExpiresAt < Date.now()) return null;
    return conn;
  } catch {
    return null;
  }
}

// ── Server-side file storage ─────────────────────────────────────────────

function saveToFile(sealed: string): void {
  try {
    mkdirSync(dirname(CONNECTION_FILE), { recursive: true });
    writeFileSync(CONNECTION_FILE, sealed, "utf-8");
    logInfo("session", "eBay connection saved to server file");
  } catch (e) {
    logError("session", "Failed to save eBay connection to file", e);
  }
}

function loadFromFile(): string | undefined {
  try {
    return readFileSync(CONNECTION_FILE, "utf-8").trim() || undefined;
  } catch {
    return undefined;
  }
}

export function deleteFile(): void {
  try {
    unlinkSync(CONNECTION_FILE);
  } catch {
    // ignore
  }
}

// ── Public API ───────────────────────────────────────────────────────────

// Build a Connection from a fresh token-exchange response.
export function connectionFromToken(
  refreshToken: string,
  refreshExpiresIn?: number
): Connection {
  const ttl = (refreshExpiresIn ?? 47304000) * 1000; // default ~18 months
  return { refreshToken, refreshExpiresAt: Date.now() + ttl };
}

// Save a sealed connection — writes to both server file and returns the
// value to set as a cookie.
export async function saveConnection(conn: Connection): Promise<string> {
  const sealed = await sealConnection(conn);
  saveToFile(sealed);
  return sealed;
}

// Get a short-lived access token. Checks server file first, then cookie.
export async function accessTokenFromCookie(
  cookieValue: string | undefined
): Promise<string | null> {
  // Prefer server-side file (shared across devices).
  const serverSealed = loadFromFile();
  const conn = await openConnection(serverSealed);
  if (conn) {
    const token = await refreshAccessToken(conn.refreshToken);
    return token.access_token;
  }

  // Fallback: try the cookie value (for backwards compat).
  const conn2 = await openConnection(cookieValue);
  if (conn2) {
    // Migrate to server file so other devices can use it.
    saveToFile(await sealConnection(conn2));
    const token = await refreshAccessToken(conn2.refreshToken);
    return token.access_token;
  }

  return null;
}

// Check if eBay is connected (server file or cookie).
export async function isConnected(
  cookieValue: string | undefined
): Promise<boolean> {
  const serverSealed = loadFromFile();
  if (serverSealed) {
    const conn = await openConnection(serverSealed);
    if (conn) return true;
  }
  const conn = await openConnection(cookieValue);
  return conn !== null;
}
