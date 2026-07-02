// Client-side persistence using IndexedDB + server sync.
// Photos stay in IndexedDB (large blobs). Metadata (groups, listings, step)
// syncs to the server so any device can resume the workflow.
//
// Strategy:
// - Save: always write full state to IndexedDB; sync metadata to server (debounced)
// - Load: fetch server metadata, merge with local photos from IndexedDB

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
  /** Photo IDs only — the actual blobs stay in IndexedDB on each device. */
  photoIds: string[];
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
  if (!local) {
    // Server has metadata but no local photos — can't fully resume.
    // Return a skeleton with empty photos so the user knows there's a draft
    // but needs to re-upload photos on this device.
    return {
      id: "current",
      photos: [],
      binPrefix: server.binPrefix,
      step: server.step,
      groups: server.groups,
      orphanIds: server.orphanIds,
      savedAt: server.savedAt,
    };
  }

  // Merge: use server metadata (more recent from any device) + local photos
  // Server metadata wins for groups/listings/step; local photos are authoritative.
  const merged: PersistedState = {
    id: "current",
    photos: local.photos,
    binPrefix: server.binPrefix || local.binPrefix,
    step: server.savedAt > local.savedAt ? server.step : local.step,
    groups: server.savedAt > local.savedAt ? server.groups : local.groups,
    orphanIds: server.savedAt > local.savedAt ? server.orphanIds : local.orphanIds,
    savedAt: Math.max(server.savedAt, local.savedAt),
  };

  // Update local with merged result
  await saveLocal(merged);
  return merged;
}

/**
 * Clear session from both local and server.
 */
export async function clearSession(): Promise<void> {
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
    await fetch("/api/draft", {
      method: "POST",
      headers,
      body: JSON.stringify(null),
    });
  } catch {
    // ignore
  }
}
