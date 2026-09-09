// Client-side persistence using IndexedDB + server sync.
// Photos stay in IndexedDB (large blobs). Metadata (groups, listings, step)
// syncs to the server so any device can resume the workflow.
//
// Strategy:
// - Save: always write full state to IndexedDB; sync metadata to server (debounced)
// - Load: fetch server metadata, merge with local photos from IndexedDB,
//   and rehydrate any missing photos from the server photo store.

import type { Photo } from "@/lib/types";

const DB_NAME = "listing-writer";
const DB_VERSION = 1;
const STORE = "session";

export interface PersistedState {
  id: "current";
  photos: { id: string; previewUrl: string; mediaType: string; data: string }[];
  binPrefix: string;
  step: string;
  groups: {
    id: string;
    sku: string;
    name: string;
    photoIds: string[];
    listing?: unknown;
    status: string;
    error?: string;
    shippingOption?: string;
    postStatus?: string;
    listingId?: string;
    postError?: string;
    crossList?: {
      poshmark?: { status: string; url?: string };
      depop?: { status: string; url?: string };
    };
  }[];
  orphanIds: string[];
  savedAt: number;
}

/** Lightweight metadata for server sync — no photo blobs. */
interface DraftMeta {
  binPrefix: string;
  step: string;
  groups: PersistedState["groups"];
  orphanIds: string[];
  savedAt: number;
  /** Photo IDs only — blobs live in the browser IndexedDB AND are mirrored
   *  to the server photo store (/api/photos) so other devices can rehydrate. */
  photoIds: string[];
}

/** Photos as the server photo store expects them. */
type ServerPhoto = { id: string; mediaType: string; data: string };
const syncedPhotoIds = new Set<string>();
const PHOTO_SYNC_CHUNK_BYTES = 8 * 1024 * 1024;

/** Split a photo id (`id-<batch>-<rand>`) into its batch segment. */
function photoBatch(id: string): string {
  return id.split("-")[1] || "";
}

/**
 * Fetch server-stored photos for every batch referenced by a draft's photo
 * ids. Best-effort — returns [] on any failure so restore never blocks.
 */
async function fetchServerPhotos(photoIds: string[]): Promise<ServerPhoto[]> {
  const batches = new Set<string>();
  for (const id of photoIds) {
    const b = photoBatch(id);
    if (b) batches.add(b);
  }
  if (batches.size === 0) return [];
  const code = getAccessCode();
  const headers: Record<string, string> = {};
  if (code) headers["x-app-secret"] = code;
  try {
    const results = await Promise.all(
      [...batches].map(async (b) => {
        try {
          const res = await fetch(`/api/photos?batch=${encodeURIComponent(b)}`, { headers });
          if (!res.ok) return [];
          const data = await res.json();
          return Array.isArray(data?.photos) ? (data.photos as ServerPhoto[]) : [];
        } catch {
          return [];
        }
      })
    );
    return results.flat();
  } catch {
    return [];
  }
}

/** Merge server photos into local state without clobbering local copies. */
function batchPhotos(photos: Photo[], fetched: ServerPhoto[]): Photo[] {
  const byId = new Map(photos.map((p) => [p.id, p]));
  for (const s of fetched) {
    if (!s?.id || !s?.data) continue;
    if (byId.has(s.id)) continue; // local copy wins (identical, freshest)
    const preview =
      s.mediaType === "image/jpeg"
        ? `data:image/jpeg;base64,${s.data}`
        : s.data;
    byId.set(s.id, { id: s.id, mediaType: s.mediaType, data: s.data, previewUrl: preview });
  }
  return [...byId.values()];
}

/**
 * Mirror this device's photos to the server photo store, grouped by batch.
 * Best-effort (network can be flaky); the local IndexedDB copy is authoritative.
 * Batches are merged server-side, so a partial sync never loses other photos.
 */
export async function syncServerPhotos(photos: Photo[]): Promise<void> {
  if (photos.length === 0) return;
  const code = getAccessCode();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (code) headers["x-app-secret"] = code;
  const byBatch = new Map<string, ServerPhoto[]>();
  for (const p of photos) {
    if (syncedPhotoIds.has(p.id)) continue;
    const b = photoBatch(p.id);
    if (!b || !p.data) continue;
    const arr = byBatch.get(b) ?? [];
    arr.push({ id: p.id, mediaType: p.mediaType, data: p.data });
    byBatch.set(b, arr);
  }
  await Promise.all(
    [...byBatch.entries()].map(async ([b, list]) => {
      const chunks: ServerPhoto[][] = [];
      let chunk: ServerPhoto[] = [];
      let chunkBytes = 0;
      for (const photo of list) {
        const bytes = photo.data.length + photo.id.length + photo.mediaType.length + 64;
        if (chunk.length > 0 && chunkBytes + bytes > PHOTO_SYNC_CHUNK_BYTES) {
          chunks.push(chunk);
          chunk = [];
          chunkBytes = 0;
        }
        chunk.push(photo);
        chunkBytes += bytes;
      }
      if (chunk.length > 0) chunks.push(chunk);

      // Chunks for one batch must be sequential because the disk endpoint
      // performs a read/merge/write. Different batches can still sync in parallel.
      for (const photosInChunk of chunks) {
        try {
          const res = await fetch("/api/photos", {
            method: "POST",
            headers,
            body: JSON.stringify({ batch: b, photos: photosInChunk }),
          });
          if (!res.ok) break;
          photosInChunk.forEach((photo) => syncedPhotoIds.add(photo.id));
        } catch {
          break; // Best effort — remaining photos retry on the next state change.
        }
      }
    })
  );
}

/** Delete server-side photos that are gone from this device (draft-safe). */
export async function pruneServerPhotos(removedIds: string[]): Promise<void> {
  if (removedIds.length === 0) return;
  const code = getAccessCode();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (code) headers["x-app-secret"] = code;
  try {
    removedIds.forEach((id) => syncedPhotoIds.delete(id));
    await fetch("/api/photos", {
      method: "PUT",
      headers,
      body: JSON.stringify({ removedIds }),
    });
  } catch {
    // Best effort.
  }
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── IndexedDB (full state with photos) ──────────────────────────────────

async function saveLocal(state: PersistedState): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(state, "current");
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Silently fail
  }
}

async function loadLocal(): Promise<PersistedState | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get("current");
    const result = await new Promise<PersistedState | undefined>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result as PersistedState | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result ?? null;
  } catch {
    return null;
  }
}

// ── Server sync (metadata only — no photo blobs) ────────────────────────

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function toDraftMeta(state: PersistedState): DraftMeta {
  return {
    binPrefix: state.binPrefix,
    step: state.step,
    groups: state.groups,
    orphanIds: state.orphanIds,
    savedAt: state.savedAt,
    photoIds: state.photos.map((p) => p.id),
  };
}

function getAccessCode(): string | null {
  try {
    return localStorage.getItem("listing-writer:access-code");
  } catch {
    return null;
  }
}

async function saveServer(meta: DraftMeta): Promise<void> {
  try {
    const code = getAccessCode();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (code) headers["x-app-secret"] = code;
    await fetch("/api/draft", {
      method: "POST",
      headers,
      body: JSON.stringify(meta),
    });
  } catch {
    // Best effort
  }
}

async function loadServer(): Promise<DraftMeta | null> {
  try {
    const code = getAccessCode();
    const headers: Record<string, string> = {};
    if (code) headers["x-app-secret"] = code;
    const res = await fetch("/api/draft", { headers });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.draft ?? null;
  } catch {
    return null;
  }
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Save session state. Writes full state (including photos) to IndexedDB
 * immediately. Debounces a lightweight metadata-only save to the server.
 */
export async function saveSession(state: PersistedState): Promise<void> {
  // Always save locally first (full state with photos)
  await saveLocal(state);

  // Debounce server save (metadata only, no blobs)
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void saveServer(toDraftMeta(state));
  }, 2000);
}

/**
 * Load session state. Checks the server for metadata (groups, listings)
 * from any device, then merges with local photos from IndexedDB.
 * Falls back to pure local if server is unreachable.
 */
export async function loadSession(): Promise<PersistedState | null> {
  const local = await loadLocal();
  const server = await loadServer();

  if (!server && !local) return null;
  if (!server) return local;

  // Merge: server metadata wins when it's newer (any device may have updated
  // it); local photos are the starting blob set.
  const serverWins = !local || server.savedAt > local.savedAt;
  const merged: PersistedState = {
    id: "current",
    photos: local?.photos ?? [],
    binPrefix: server.binPrefix || local?.binPrefix || "",
    step: serverWins ? server.step : local!.step,
    groups: serverWins ? server.groups : local!.groups,
    orphanIds: serverWins ? server.orphanIds : local!.orphanIds,
    savedAt: Math.max(server.savedAt, local?.savedAt ?? 0),
  };

  // Rehydrate photos this device doesn't have (restored on another phone,
  // after a browser data clear, etc.) from the server photo store.
  const have = new Set(merged.photos.map((p) => p.id));
  const needed = new Set<string>();
  const collect = (ids: string[] | undefined) =>
    (ids ?? []).forEach((id) => {
      if (id && !have.has(id)) needed.add(id);
    });
  collect(server.photoIds);
  collect(merged.orphanIds);
  merged.groups.forEach((g) => collect(g.photoIds));
  if (needed.size > 0) {
    const fetched = await fetchServerPhotos([...needed]);
    if (fetched.length > 0) merged.photos = batchPhotos(merged.photos, fetched);
  }

  // Update local with merged result
  await saveLocal(merged);
  return merged;
}

/**
 * Clear session from both local and server.
 */
export async function clearSession(): Promise<void> {
  syncedPhotoIds.clear();
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete("current");
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    db.close();
  } catch {
    // ignore
  }

  try {
    const code = getAccessCode();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (code) headers["x-app-secret"] = code;
    await Promise.all([
      fetch("/api/draft", {
        method: "POST",
        headers,
        body: JSON.stringify(null),
      }),
      fetch("/api/photos", { method: "DELETE", headers }),
    ]);
  } catch {
    // ignore
  }
}
