// Persistent store for the custom listing instructions, backed by Vercel Blob.
//
// On Vercel the serverless filesystem is ephemeral (a /tmp write does not
// survive across invocations), so the Blob store is the source of truth for
// persistence. This module owns ALL persistence; the API route only calls
// these two functions. Both are written to fail soft — a blob error must
// NEVER throw or 500 the UI, it should just degrade to the fallback path.
//
// Auth: relies on BLOB_READ_WRITE_TOKEN (or BLOB_STORE_ID). The SDK parses the
// store id from the read-write token itself, so the token alone is enough.

import { get, put } from "@vercel/blob";

const BLOB_PATHNAME = "instructions.txt";
const TIMEOUT_MS = 8_000;

function hasCredentials(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID
  );
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("blob operation timed out")), TIMEOUT_MS)
    ),
  ]);
}

/**
 * Read the stored instructions from the blob.
 * Returns null if there are no credentials, the blob is missing/empty, or
 * anything errors. Never throws.
 */
export async function readStoredInstructions(): Promise<string | null> {
  if (!hasCredentials()) return null;
  try {
    const result = await withTimeout(
      get(BLOB_PATHNAME, { access: "private", useCache: false })
    );
    if (!result || result.statusCode !== 200) return null;
    const text = await new Response(result.stream).text();
    if (!text.trim()) return null;
    return text;
  } catch {
    return null;
  }
}

/**
 * Write the instructions to the blob (overwriting in place).
 * Returns true on success, false on any error. Refuses to overwrite the
 * stored value with an empty/whitespace-only string. Never throws.
 */
export async function writeStoredInstructions(text: string): Promise<boolean> {
  if (!hasCredentials()) return false;
  if (!text.trim()) return false;
  try {
    await withTimeout(
      put(BLOB_PATHNAME, text, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "text/plain",
      })
    );
    return true;
  } catch {
    return false;
  }
}
