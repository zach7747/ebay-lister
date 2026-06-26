"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiPost } from "@/lib/api-client";
import { resizeImage } from "@/lib/resize";
import { buildSku } from "@/lib/sku";
import { EbayConnect } from "./EbayConnect";
import { ReviewBoard } from "./ReviewBoard";
import { ListingsView } from "./ListingsView";
import { DraftsView } from "./DraftsView";
import { saveSession, loadSession, clearSession } from "@/lib/persist";
import type {
  AnalyzeResponse,
  ItemGroup,
  ListingResult,
  Photo,
  SortResponse,
} from "@/lib/types";

type Step = "upload" | "review" | "listings" | "drafts";
// Keep a whole batch's sort payload comfortably under Vercel's 4.5 MB request
// limit (sort sends small thumbnails for every photo at once).
const MAX_PHOTOS = 100;
const WRITE_CONCURRENCY = 3;

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Math.floor(performance.now() * 1000)}-${Math.random()}`;
}

// Parse a fetch response as JSON, but turn non-JSON error bodies (e.g. a 413
// "Request Entity Too Large" plain-text page) into a friendly message instead
// of a cryptic "Unexpected token" error.
async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    if (res.status === 413) {
      throw new Error(
        "That was too much photo data to send at once. Try sorting fewer photos per batch."
      );
    }
    throw new Error(
      text.trim().slice(0, 140) || `Request failed (${res.status}).`
    );
  }
}

// Run async workers over items with a fixed concurrency limit.
async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}

export default function Home() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [binPrefix, setBinPrefix] = useState("");
  const [step, setStep] = useState<Step>("upload");
  const [groups, setGroups] = useState<ItemGroup[]>([]);
  const [orphanIds, setOrphanIds] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [sorting, setSorting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ebayConnected, setEbayConnected] = useState(false);
  const [customInstructions, setCustomInstructions] = useState("");
  const [showInstructions, setShowInstructions] = useState(false);
  const [savedDraftIds, setSavedDraftIds] = useState<Set<string>>(new Set());
  const instructionsLoaded = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Restore session on mount ─────────────────────────────
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    loadSession().then((saved) => {
      if (!saved) return;
      // Only restore if saved within the last 24 hours.
      if (Date.now() - saved.savedAt > 24 * 60 * 60 * 1000) {
        clearSession();
        return;
      }
      setPhotos(Array.isArray(saved.photos) ? saved.photos : []);
      setBinPrefix(saved.binPrefix || "");
      setStep((saved.step || "upload") as Step);
      setGroups(Array.isArray(saved.groups) ? (saved.groups as ItemGroup[]).map((g) => ({ ...g, photoIds: Array.isArray(g.photoIds) ? g.photoIds : [] })) : []);
      setOrphanIds(Array.isArray(saved.orphanIds) ? saved.orphanIds : []);
    });
  }, []);

  // ── Save session on change (debounced) ───────────────────
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!restoredRef.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveSession({
        id: "current",
        photos,
        binPrefix,
        step,
        groups,
        orphanIds,
        savedAt: Date.now(),
      });
    }, 500);
    return () => clearTimeout(saveTimer.current);
  }, [photos, binPrefix, step, groups, orphanIds]);

  const photoMap = useMemo(() => {
    const m = new Map<string, Photo>();
    photos.forEach((p) => m.set(p.id, p));
    return m;
  }, [photos]);
  const photoById = useCallback((id: string) => photoMap.get(id), [photoMap]);

  // Latest groups, readable inside async workers without stale closures.
  const groupsRef = useRef(groups);
  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  // Keep eBay connection status in sync (also after the connect bar updates).
  useEffect(() => {
    const check = () =>
      fetch("/api/ebay/status", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => setEbayConnected(Boolean(d.connected)))
        .catch(() => setEbayConnected(false));
    check();
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Load custom listing instructions from server.
  useEffect(() => {
    if (instructionsLoaded.current) return;
    instructionsLoaded.current = true;
    fetch("/api/instructions")
      .then((r) => r.json())
      .then((d) => { if (d.text) setCustomInstructions(d.text); })
      .catch(() => {});
  }, []);

  // Save custom instructions to server (debounced).
  useEffect(() => {
    if (!instructionsLoaded.current) return;
    const t = setTimeout(() => {
      fetch("/api/instructions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: customInstructions }),
      }).catch(() => {});
    }, 1000);
    return () => clearTimeout(t);
  }, [customInstructions]);

  // ── Upload ──────────────────────────────────────────────
  const addFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setError(null);
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) {
      setError("Those didn't look like photos. Use JPG, PNG, or WebP.");
      return;
    }
    try {
      const resized = await Promise.all(files.map(resizeImage));
      setPhotos((prev) =>
        [...prev, ...resized.map((r) => ({ id: newId(), ...r }))].slice(
          0,
          MAX_PHOTOS
        )
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const removePhoto = (id: string) =>
    setPhotos((prev) => prev.filter((p) => p.id !== id));

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void addFiles(e.dataTransfer.files);
  };

  // ── Sort ────────────────────────────────────────────────
  const sort = async () => {
    if (photos.length === 0) return;
    setSorting(true);
    setError(null);
    try {
      const res = await apiPost("/api/sort", {
        // Use the small thumbnail for sorting to keep the payload small.
        images: photos.map((p) => ({
          mediaType: p.mediaType,
          data: p.previewUrl.split(",")[1],
        })),
      });
      const data = (await readJson(res)) as SortResponse;
      if (!data.ok || !data.groups) {
        throw new Error(data.error || "Could not sort the photos.");
      }
      const idxToId = (i: number) => photos[i]?.id;
      const assigned = new Set<string>();
      const nextGroups: ItemGroup[] = data.groups.map((g, i) => {
        const ids = g.photoIndices.map(idxToId).filter(Boolean) as string[];
        ids.forEach((id) => assigned.add(id));
        return {
          id: newId(),
          sku: buildSku(binPrefix, i),
          name: g.name,
          photoIds: ids,
          status: "idle",
        };
      });
      const orphans = (data.orphanIndices ?? [])
        .map(idxToId)
        .filter(Boolean) as string[];
      orphans.forEach((id) => assigned.add(id));
      // Any photo the sorter never placed shouldn't vanish — surface it.
      const leftover = photos.filter((p) => !assigned.has(p.id)).map((p) => p.id);
      setGroups(nextGroups);
      setOrphanIds([...orphans, ...leftover]);
      setStep("review");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSorting(false);
    }
  };

  // ── Review edits ────────────────────────────────────────
  const rename = (groupId: string, name: string) =>
    setGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, name } : g))
    );

  const renameSku = (groupId: string, sku: string) =>
    setGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, sku } : g))
    );

  const movePhoto = (photoId: string, toGroupId: string | "orphans") => {
    setGroups((prev) =>
      prev.map((g) => ({
        ...g,
        photoIds:
          g.id === toGroupId
            ? g.photoIds.includes(photoId)
              ? g.photoIds
              : [...g.photoIds, photoId]
            : g.photoIds.filter((id) => id !== photoId),
      }))
    );
    setOrphanIds((prev) => {
      const without = prev.filter((id) => id !== photoId);
      return toGroupId === "orphans" ? [...without, photoId] : without;
    });
  };

  const deleteGroup = (groupId: string) =>
    setGroups((prev) => {
      const target = prev.find((g) => g.id === groupId);
      if (target && target.photoIds.length > 0) {
        setOrphanIds((o) => [...o, ...target.photoIds]);
      }
      return prev.filter((g) => g.id !== groupId);
    });

  const addGroup = () =>
    setGroups((prev) => [
      ...prev,
      {
        id: newId(),
        sku: buildSku(binPrefix, prev.length),
        name: `new-item-${prev.length + 1}`,
        photoIds: [],
        status: "idle",
      },
    ]);

  // ── Write listings ──────────────────────────────────────
  const writeGroup = useCallback(
    async (groupId: string) => {
      // Snapshot this group's photos from the latest state (no stale closure).
      const group = groupsRef.current.find((g) => g.id === groupId);
      if (!group) return;
      const imgs = group.photoIds
        .map((id) => photoMap.get(id))
        .filter((p): p is Photo => Boolean(p))
        .map((p) => ({ mediaType: p.mediaType, data: p.data }));
      setGroups((prev) =>
        prev.map((g) =>
          g.id === groupId ? { ...g, status: "writing", error: undefined } : g
        )
      );
      try {
        const res = await apiPost("/api/analyze", { profile: "auto", images: imgs, customInstructions });
        const data = (await readJson(res)) as AnalyzeResponse;
        if (!data.ok || !data.listing) {
          throw new Error(data.error || "Could not write this listing.");
        }
        setGroups((prev) =>
          prev.map((g) =>
            g.id === groupId
              ? { ...g, status: "done", listing: data.listing }
              : g
          )
        );
      } catch (e) {
        setGroups((prev) =>
          prev.map((g) =>
            g.id === groupId
              ? { ...g, status: "error", error: (e as Error).message }
              : g
          )
        );
      }
    },
    [photoMap]
  );

  const writeAll = async () => {
    const usable = groups.filter((g) => g.photoIds.length > 0).map((g) => g.id);
    if (usable.length === 0) return;
    setStep("listings");
    await runPool(usable, WRITE_CONCURRENCY, writeGroup);
  };

  const editListing = (groupId: string, patch: Partial<ListingResult>) =>
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId && g.listing
          ? { ...g, listing: { ...g.listing, ...patch } }
          : g
      )
    );

  const postGroup = useCallback(
    async (groupId: string) => {
      const group = groupsRef.current.find((g) => g.id === groupId);
      if (!group || !group.listing) return;
      const images = group.photoIds
        .map((id) => photoMap.get(id))
        .filter((p): p is Photo => Boolean(p))
        .map((p) => ({ mediaType: p.mediaType, data: p.data }));
      setGroups((prev) =>
        prev.map((g) =>
          g.id === groupId ? { ...g, postStatus: "posting", postError: undefined } : g
        )
      );
      try {
        const res = await apiPost("/api/ebay/publish", {
          sku: group.sku,
          listing: group.listing,
          images,
          draft: false,
        });
        const data = (await readJson(res)) as {
          success: boolean;
          listingId?: string;
          error?: string;
        };
        if (!data.success) throw new Error(data.error || "eBay rejected the listing.");
        setGroups((prev) =>
          prev.map((g) =>
            g.id === groupId
              ? { ...g, postStatus: "posted", listingId: data.listingId }
              : g
          )
        );
      } catch (e) {
        setGroups((prev) =>
          prev.map((g) =>
            g.id === groupId
              ? { ...g, postStatus: "error", postError: (e as Error).message }
              : g
          )
        );
      }
    },
    [photoMap]
  );

  const postAll = async () => {
    const ready = groups
      .filter((g) => g.status === "done" && g.postStatus !== "posted")
      .map((g) => g.id);
    // Sequential — keeps eBay calls gentle and errors easy to read.
    for (const id of ready) {
      await postGroup(id);
    }
  };

  // ── Save to drafts ───────────────────────────────────────
  const saveToDraft = useCallback(
    async (groupId: string) => {
      const group = groupsRef.current.find((g) => g.id === groupId);
      if (!group || !group.listing) return;

      // Collect photo data for this group
      const photos = group.photoIds
        .map((id) => photoMap.get(id))
        .filter((p): p is Photo => Boolean(p))
        .map((p) => ({
          previewUrl: p.previewUrl,
          data: p.data,
          mediaType: p.mediaType,
        }));

      const draft = {
        id: group.id,
        sku: group.sku,
        name: group.name,
        listing: group.listing,
        photos,
        status: "pending" as const,
        createdAt: Date.now(),
      };

      try {
        const code = localStorage.getItem("listing-writer:access-code");
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (code) headers["x-app-secret"] = code;
        const res = await fetch("/api/ebay/drafts", {
          method: "POST",
          headers,
          body: JSON.stringify(draft),
        });
        const data = await res.json();
        if (data.ok) {
          setSavedDraftIds((prev) => new Set(prev).add(groupId));
        }
      } catch {
        // Silently fail — the listing still exists in the current session
      }
    },
    [photoMap]
  );

  const saveAllToDrafts = async () => {
    const ready = groups
      .filter((g) => g.status === "done" && !savedDraftIds.has(g.id))
      .map((g) => g.id);
    for (const id of ready) {
      await saveToDraft(id);
    }
  };

  const usableGroups = useMemo(
    () => groups.filter((g) => g.photoIds.length > 0),
    [groups]
  );

  return (
    <main className="wrap">
      <header className="masthead">
        <span className="logo-mark" aria-hidden="true">🪄</span>
        <div>
          <h1>Listing Writer</h1>
          <p>Upload a pile of photos • auto-sort into items • write every listing</p>
        </div>
      </header>

      <div className="top-actions">
        {step !== "drafts" && (
          <button
            type="button"
            className="btn-pill"
            onClick={() => setStep("drafts")}
          >
            <span className="pill-icon">📋</span> Drafts
          </button>
        )}
        <button
          type="button"
          className="btn-pill"
          onClick={() => {
            clearSession();
            setPhotos([]);
            setBinPrefix("");
            setStep("upload");
            setGroups([]);
            setOrphanIds([]);
            setSavedDraftIds(new Set());
          }}
        >
          <span className="pill-icon">🗑️</span> Start over
        </button>
      </div>

      <EbayConnect />

      {step === "upload" && (
        <>
          <section className="hero">
            <h2>
              Dump every photo. <em>We&rsquo;ll sort it out.</em>
            </h2>
            <p>
              Add all your photos for the whole batch at once. The app groups
              them into separate items, then writes a polished eBay listing for
              each one.
            </p>
          </section>

          <section className="panel" aria-labelledby="upload-heading">
            <h2 id="upload-heading" className="section-label">
              1 · Add all your photos
            </h2>

            <div className="field bin-field">
              <label htmlFor="bin">
                Bin / SKU code{" "}
                <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                  (where these items are stored)
                </span>
              </label>
              <input
                id="bin"
                type="text"
                placeholder="e.g. K75"
                value={binPrefix}
                onChange={(e) => setBinPrefix(e.target.value)}
                autoCapitalize="characters"
              />
              <span className="field-hint">
                Each item gets {binPrefix ? `${binPrefix.trim()}-A, ${binPrefix.trim()}-B` : "A, B, C"}
                … in order, so you can find it in the bin later. You can edit any
                SKU after sorting.
              </span>
            </div>

            <div className="field">
              <button
                type="button"
                className="btn-ghost"
                style={{ fontSize: "0.85em", padding: "4px 0", marginBottom: 4 }}
                onClick={() => setShowInstructions(!showInstructions)}
              >
                {showInstructions ? "▾" : "▸"} Custom listing instructions
              </button>
              {showInstructions && (
                <textarea
                  className="instructions-textarea"
                  placeholder="e.g. Always mention 'vintage' in titles. Use the word 'boutique'. Emphasize handmade craftsmanship. Target keywords: boho, cottagecore, Y2K."
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  rows={4}
                />
              )}
            </div>

            <div
              className={`dropzone${dragging ? " dragging" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <span className="icon" aria-hidden="true">
                📸
              </span>
              <strong>Tap to choose photos, or drag them all here</strong>
              <span>
                Every item in the batch · up to {MAX_PHOTOS} photos · JPG, PNG,
                WebP
              </span>
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => void addFiles(e.target.files)}
              />
            </div>

            {photos.length > 0 && (
              <div className="thumbs" aria-label="Selected photos">
                {photos.map((p) => (
                  <div className="thumb" key={p.id}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.previewUrl} alt="" />
                    <button
                      type="button"
                      aria-label="Remove photo"
                      onClick={() => removePhoto(p.id)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="result-actions" style={{ borderTop: "none", paddingTop: 0 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={sort}
                disabled={photos.length === 0 || sorting}
              >
                {sorting ? (
                  <>
                    <span className="spinner" aria-hidden="true" /> Sorting{" "}
                    {photos.length} photos…
                  </>
                ) : (
                  <>🔀 Sort {photos.length || ""} photos into items</>
                )}
              </button>
            </div>

            {error && (
              <p className="note note-error" role="alert">
                {error}
              </p>
            )}
          </section>

          {sorting && (
            <section className="panel">
              <div className="loading-card">
                <span className="spinner" aria-hidden="true" />
                <span>
                  Grouping photos by item, then double-checking for mixed-up or
                  split items. This takes a little while for big batches.
                </span>
              </div>
            </section>
          )}
        </>
      )}

      {step === "review" && (
        <ReviewBoard
          groups={groups}
          orphanIds={orphanIds}
          photoById={photoById}
          onRename={rename}
          onRenameSku={renameSku}
          onMovePhoto={movePhoto}
          onDeleteGroup={deleteGroup}
          onAddGroup={addGroup}
          onWriteAll={writeAll}
          onBack={() => setStep("upload")}
        />
      )}

      {step === "listings" && (
        <ListingsView
          groups={usableGroups}
          photoById={photoById}
          ebayConnected={ebayConnected}
          onEdit={editListing}
          onRetry={writeGroup}
          onPost={postGroup}
          onPostAll={postAll}
          onSaveToDraft={saveToDraft}
          onSaveAllToDrafts={saveAllToDrafts}
          savedDraftIds={savedDraftIds}
          onShowDrafts={() => setStep("drafts")}
          onBack={() => setStep("review")}
        />
      )}

      {step === "drafts" && (
        <DraftsView onBack={() => setStep("listings")} />
      )}

      <div className="security-notice">
        <span className="security-icon" aria-hidden="true">🛡️</span>
        <p>
          Your photos are sent securely to sort and write listings, and are not
          stored. Your data stays private.
        </p>
      </div>
    </main>
  );
}
