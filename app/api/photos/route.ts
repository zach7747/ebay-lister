import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, rmSync } from "fs";
import { join } from "path";
import { guardApiRequest } from "@/lib/api-guard";
import { logInfo, logError } from "@/lib/logger";

/**
 * Server-side photo store.
 *
 * Photo bytes have historically lived ONLY in the browser's IndexedDB, so a
 * session restored on a different device (or after a clear) had zero photos:
 * posting then failed with a misleading "Missing SKU, listing, or photos."
 * This route mirrors the browser's photo blobs to disk, keyed by upload batch
 * (the numeric segment of a photo id: `id-<batch>-<rand>`), so any device can
 * rehydrate a draft's photos before posting.
 *
 *   GET  /api/photos?batch=<id>  → { ok, photos: [{id, mediaType, data}] }
 *   POST /api/photos             → { batch, photos: [...] }  (upsert, merge)
 *   PUT  /api/photos             → { removedIds: [...] }     (explicit delete)
 *   DELETE /api/photos           → clear all mirrored photos
 */

const DRAFTS_DIR = join(process.env.HOME || "/root", "ebay-lister-drafts");
const PHOTOS_DIR = join(DRAFTS_DIR, "photos");
const BATCH_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const PHOTO_ID_RE = /^[A-Za-z0-9_.-]{1,128}$/;
const MAX_FILE_BYTES = 200 * 1024 * 1024; // sanity cap per batch file
const MAX_REQUEST_BYTES = 20 * 1024 * 1024; // keep under nginx client_max_body_size
const MAX_PHOTOS_PER_REQUEST = 100;

interface StoredPhoto {
  id: string;
  mediaType: string;
  data: string; // base64, no prefix
}

function batchPath(batch: string): string {
  if (!BATCH_ID_RE.test(batch)) throw new Error("Invalid batch id.");
  return join(PHOTOS_DIR, `${batch}.json`);
}

function readBatch(batch: string): Record<string, Omit<StoredPhoto, "id">> {
  const p = batchPath(batch); // throws on bad id
  if (!existsSync(p)) return {};
  try {
    const raw = readFileSync(p, "utf-8");
    if (raw.length > MAX_FILE_BYTES) return {};
    const d = JSON.parse(raw);
    if (!d || typeof d !== "object" || Array.isArray(d)) return Object.create(null);
    const clean: Record<string, Omit<StoredPhoto, "id">> = Object.create(null);
    for (const [id, value] of Object.entries(d)) {
      const photo = value as Partial<Omit<StoredPhoto, "id">>;
      if (PHOTO_ID_RE.test(id) && typeof photo.data === "string") {
        clean[id] = {
          mediaType: typeof photo.mediaType === "string" ? photo.mediaType : "image/jpeg",
          data: photo.data,
        };
      }
    }
    return clean;
  } catch {
    return Object.create(null);
  }
}

function writeBatch(batch: string, photos: Record<string, Omit<StoredPhoto, "id">>): void {
  const p = batchPath(batch);
  mkdirSync(PHOTOS_DIR, { recursive: true });
  const serialized = JSON.stringify(photos);
  if (Buffer.byteLength(serialized, "utf8") > MAX_FILE_BYTES) {
    throw new Error("This photo batch is too large to store.");
  }
  const temporary = `${p}.${process.pid}.tmp`;
  writeFileSync(temporary, serialized, "utf-8");
  renameSync(temporary, p);
}

function batchFromPhotoId(id: string): string {
  return id.split("-")[1] || "";
}

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  const batch = req.nextUrl.searchParams.get("batch") || "";
  if (!batch) {
    return NextResponse.json({ ok: false, error: "Missing batch." }, { status: 400 });
  }
  try {
    const stored = readBatch(batch);
    const photos: StoredPhoto[] = Object.entries(stored).map(([id, v]) => ({
      id,
      mediaType: v.mediaType || "image/jpeg",
      data: v.data,
    }));
    return NextResponse.json({ ok: true, batch, photos });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  let body: { batch?: string; photos?: StoredPhoto[] };
  try {
    const declaredSize = Number(req.headers.get("content-length") || "0");
    if (declaredSize > MAX_REQUEST_BYTES) {
      return NextResponse.json({ ok: false, error: "Photo upload is too large." }, { status: 413 });
    }
    const raw = await req.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_REQUEST_BYTES) {
      return NextResponse.json({ ok: false, error: "Photo upload is too large." }, { status: 413 });
    }
    body = JSON.parse(raw) as { batch?: string; photos?: StoredPhoto[] };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  const batch = String(body.batch || "");
  if (!batch) {
    return NextResponse.json({ ok: false, error: "Missing batch." }, { status: 400 });
  }
  const photos = Array.isArray(body.photos) ? body.photos : [];
  if (photos.length === 0) {
    return NextResponse.json({ ok: false, error: "No photos provided." }, { status: 400 });
  }
  if (photos.length > MAX_PHOTOS_PER_REQUEST) {
    return NextResponse.json({ ok: false, error: "Too many photos in one request." }, { status: 400 });
  }
  try {
    const stored = readBatch(batch); // validates batch id
    const incoming: number[] = [];
    for (const p of photos) {
      const id = String(p?.id || "").trim();
      const data = String(p?.data || "");
      const mediaType = String(p?.mediaType || "");
      if (
        !PHOTO_ID_RE.test(id) ||
        batchFromPhotoId(id) !== batch ||
        !data ||
        mediaType !== "image/jpeg"
      ) continue;
      stored[id] = { mediaType, data };
      incoming.push(incoming.length + 1);
    }
    writeBatch(batch, stored);
    logInfo("/api/photos", `Upserted ${incoming.length}/${photos.length} photos in batch ${batch}`);
    return NextResponse.json({ ok: true, saved: incoming.length });
  } catch (e) {
    logError("/api/photos", "Photo upsert failed", e);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}

export async function PUT(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  let body: { removedIds?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }
  const removedIds = Array.isArray(body.removedIds) ? body.removedIds : [];
  if (removedIds.length === 0) {
    return NextResponse.json({ ok: true, removed: 0 });
  }
  try {
    let totalRemoved = 0;
    // Group ids by batch so we only touch the files involved.
    const byBatch = new Map<string, string[]>();
    for (const raw of removedIds) {
      const id = String(raw || "");
      if (!PHOTO_ID_RE.test(id)) continue;
      const batch = batchFromPhotoId(id);
      if (!batch) continue;
      const arr = byBatch.get(batch) ?? [];
      arr.push(id);
      byBatch.set(batch, arr);
    }
    for (const [batch, ids] of byBatch) {
      const stored = readBatch(batch);
      let changed = false;
      for (const id of ids) {
        if (id in stored) {
          delete stored[id];
          changed = true;
          totalRemoved++;
        }
      }
      if (changed) writeBatch(batch, stored);
    }
    logInfo("/api/photos", `Removed ${totalRemoved} photos (${removedIds.length} requested)`);
    return NextResponse.json({ ok: true, removed: totalRemoved });
  } catch (e) {
    logError("/api/photos", "Photo removal failed", e);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  try {
    rmSync(PHOTOS_DIR, { recursive: true, force: true });
    logInfo("/api/photos", "Cleared mirrored photos");
    return NextResponse.json({ ok: true });
  } catch (e) {
    logError("/api/photos", "Photo clear failed", e);
    return NextResponse.json({ ok: false, error: "Could not clear mirrored photos." }, { status: 500 });
  }
}
