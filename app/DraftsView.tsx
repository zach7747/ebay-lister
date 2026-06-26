"use client";

import { useEffect, useState } from "react";
import type { ListingResult } from "@/lib/types";

export interface SavedDraft {
  id: string;
  sku: string;
  name: string;
  listing: ListingResult;
  // Photos stored as {previewUrl, data} — preview for thumbnails, data for eBay upload
  photos: { previewUrl: string; data: string; mediaType: string }[];
  status: "pending" | "publishing" | "published" | "error";
  createdAt: number;
  updatedAt?: number;
  ebayListingId?: string;
  error?: string;
}

interface DraftsViewProps {
  onBack: () => void;
}

export function DraftsView({ onBack }: DraftsViewProps) {
  const [drafts, setDrafts] = useState<SavedDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editListing, setEditListing] = useState<ListingResult | null>(null);

  const loadDrafts = async () => {
    setLoading(true);
    try {
      const code = localStorage.getItem("listing-writer:access-code");
      const headers: Record<string, string> = {};
      if (code) headers["x-app-secret"] = code;
      const res = await fetch("/api/ebay/drafts", { headers, cache: "no-store" });
      const data = await res.json();
      if (data.ok) setDrafts(data.drafts || []);
      else setError(data.error || "Failed to load drafts.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDrafts();
  }, []);

  const deleteDraft = async (id: string) => {
    if (!confirm("Delete this draft?")) return;
    try {
      const code = localStorage.getItem("listing-writer:access-code");
      const headers: Record<string, string> = {};
      if (code) headers["x-app-secret"] = code;
      await fetch(`/api/ebay/drafts?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers,
      });
      setDrafts((prev) => prev.filter((d) => d.id !== id));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const saveEdit = async (draft: SavedDraft) => {
    if (!editListing) return;
    const updated = { ...draft, listing: editListing };
    try {
      const code = localStorage.getItem("listing-writer:access-code");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (code) headers["x-app-secret"] = code;
      await fetch("/api/ebay/drafts", {
        method: "POST",
        headers,
        body: JSON.stringify(updated),
      });
      setDrafts((prev) =>
        prev.map((d) => (d.id === draft.id ? updated : d))
      );
      setEditingId(null);
      setEditListing(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const publishDraft = async (draft: SavedDraft) => {
    // Update local state
    setDrafts((prev) =>
      prev.map((d) =>
        d.id === draft.id ? { ...d, status: "publishing" as const, error: undefined } : d
      )
    );
    try {
      const code = localStorage.getItem("listing-writer:access-code");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (code) headers["x-app-secret"] = code;

      // Photos are stored with base64 data (no prefix) in the draft
      const images = draft.photos.map((p) => ({
        mediaType: p.mediaType,
        data: p.data,
      }));

      const res = await fetch("/api/ebay/publish", {
        method: "POST",
        headers,
        body: JSON.stringify({
          sku: draft.sku,
          listing: draft.listing,
          images,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "eBay rejected the listing.");

      // Update draft status
      const updated = {
        ...draft,
        status: "published" as const,
        ebayListingId: data.listingId,
        listing: draft.listing,
      };
      await fetch("/api/ebay/drafts", {
        method: "POST",
        headers,
        body: JSON.stringify(updated),
      });
      setDrafts((prev) =>
        prev.map((d) => (d.id === draft.id ? updated : d))
      );
    } catch (e) {
      const errMsg = (e as Error).message;
      const updated = { ...draft, status: "error" as const, error: errMsg };
      const code2 = localStorage.getItem("listing-writer:access-code");
      const headers2: Record<string, string> = { "Content-Type": "application/json" };
      if (code2) headers2["x-app-secret"] = code2;
      await fetch("/api/ebay/drafts", {
        method: "POST",
        headers: headers2,
        body: JSON.stringify(updated),
      });
      setDrafts((prev) =>
        prev.map((d) => (d.id === draft.id ? updated : d))
      );
    }
  };

  const publishAll = async () => {
    const pending = drafts.filter((d) => d.status === "pending");
    for (const d of pending) {
      await publishDraft(d);
    }
  };

  const pending = drafts.filter((d) => d.status === "pending").length;
  const published = drafts.filter((d) => d.status === "published").length;
  const errors = drafts.filter((d) => d.status === "error").length;

  return (
    <section className="panel" aria-labelledby="drafts-heading">
      <div className="result-head">
        <h3 id="drafts-heading">📋 Saved Drafts</h3>
        <span className="badge">
          {drafts.length} total
          {pending > 0 ? ` · ${pending} ready` : ""}
          {published > 0 ? ` · ${published} published` : ""}
          {errors > 0 ? ` · ${errors} failed` : ""}
        </span>
      </div>

      {loading && (
        <div className="loading-card">
          <span className="spinner" aria-hidden="true" />
          <span>Loading drafts…</span>
        </div>
      )}

      {error && (
        <p className="note note-error" role="alert">
          {error}
          <button type="button" className="btn-ghost" onClick={() => setError(null)}>
            Dismiss
          </button>
        </p>
      )}

      {!loading && drafts.length === 0 && (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--color-muted)" }}>
          <p>No saved drafts yet.</p>
          <p style={{ fontSize: "0.85em", marginTop: "0.5rem" }}>
            In the listings view, click <strong>💾 Save to Drafts</strong> on any listing
            to save it here for review before publishing.
          </p>
        </div>
      )}

      {pending > 0 && (
        <div className="post-all-bar">
          <span>{pending} draft{pending > 1 ? "s" : ""} ready to publish</span>
          <button
            type="button"
            className="btn btn-primary"
            onClick={publishAll}
            disabled={drafts.some((d) => d.status === "publishing")}
          >
            {drafts.some((d) => d.status === "publishing") ? (
              <>
                <span className="spinner" aria-hidden="true" /> Publishing…
              </>
            ) : (
              `🚀 Publish all ${pending} to eBay`
            )}
          </button>
        </div>
      )}

      <div className="listing-list">
        {drafts.map((draft) => {
          const cover = draft.photos?.[0]?.previewUrl;
          const isEditing = editingId === draft.id;
          const listing = isEditing ? editListing : draft.listing;

          return (
            <article
              key={draft.id}
              className={`listing-card status-${draft.status === "pending" ? "done" : draft.status === "publishing" ? "writing" : draft.status === "published" ? "done" : "error"}`}
            >
              <header className="listing-card-head">
                {cover && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="listing-cover" src={cover} alt="" />
                )}
                <div className="listing-card-title">
                  <strong>
                    {draft.sku && <span className="sku-tag">{draft.sku}</span>}
                    {draft.listing?.title || draft.name}
                  </strong>
                  <span className="listing-card-sub">
                    {draft.status === "pending" && "📝 Ready to publish"}
                    {draft.status === "publishing" && (
                      <>
                        <span className="spinner small" aria-hidden="true" /> Publishing…
                      </>
                    )}
                    {draft.status === "published" && (
                      <>
                        ✅ Published
                        {draft.ebayListingId ? (
                          <>
                            {" · "}
                            <a
                              href={`https://www.ebay.com/itm/${draft.ebayListingId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              View ↗
                            </a>
                          </>
                        ) : null}
                      </>
                    )}
                    {draft.status === "error" && (
                      <span style={{ color: "var(--color-danger)" }}>
                        ⚠️ {draft.error || "Failed"}
                      </span>
                    )}
                    {" · "}
                    <span style={{ fontSize: "0.8em", opacity: 0.7 }}>
                      {new Date(draft.createdAt).toLocaleDateString()}
                    </span>
                  </span>
                </div>
              </header>

              {listing && (
                <div className="listing-card-body" style={{ display: isEditing ? "block" : "none" }}>
                  {isEditing && editListing && (
                    <>
                      <div className="result-field">
                        <label>Title</label>
                        <textarea
                          className="title-input"
                          value={editListing.title}
                          onChange={(e) =>
                            setEditListing({ ...editListing, title: e.target.value })
                          }
                          rows={2}
                        />
                      </div>
                      <div className="meta-row">
                        <div className="stat editable">
                          <label className="k">Price</label>
                          <div className="price-input">
                            <span aria-hidden="true">$</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              inputMode="decimal"
                              value={
                                editListing.suggested_price !== undefined
                                  ? String(editListing.suggested_price)
                                  : ""
                              }
                              onChange={(e) =>
                                setEditListing({
                                  ...editListing,
                                  suggested_price:
                                    e.target.value === "" ? "" : Number(e.target.value),
                                })
                              }
                            />
                          </div>
                        </div>
                        <div className="stat editable">
                          <label className="k">Condition</label>
                          <select
                            value={editListing.condition ?? "GOOD"}
                            onChange={(e) =>
                              setEditListing({ ...editListing, condition: e.target.value })
                            }
                          >
                            <option value="NEW_WITH_TAGS">New with tags</option>
                            <option value="NEW_NO_TAGS">New without tags</option>
                            <option value="EXCELLENT">Pre-owned · Excellent</option>
                            <option value="VERY_GOOD">Pre-owned · Very good</option>
                            <option value="GOOD">Pre-owned · Good</option>
                            <option value="FAIR">Pre-owned · Fair</option>
                          </select>
                        </div>
                      </div>
                      <div className="result-field">
                        <label>Description</label>
                        <textarea
                          value={editListing.description}
                          onChange={(e) =>
                            setEditListing({ ...editListing, description: e.target.value })
                          }
                          rows={6}
                        />
                      </div>
                      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => saveEdit(draft)}
                        >
                          💾 Save changes
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => {
                            setEditingId(null);
                            setEditListing(null);
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              <div
                className="result-actions"
                style={{ borderTop: "none", paddingTop: "0.5rem" }}
              >
                {draft.status === "pending" && (
                  <>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => publishDraft(draft)}
                    >
                      🚀 Publish to eBay
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => {
                        setEditingId(draft.id);
                        setEditListing({ ...draft.listing });
                      }}
                    >
                      ✏️ Edit
                    </button>
                  </>
                )}
                {draft.status === "error" && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => publishDraft(draft)}
                  >
                    ↻ Retry publish
                  </button>
                )}
                {draft.status !== "publishing" && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ marginLeft: draft.status === "pending" || draft.status === "error" ? undefined : "0" }}
                    onClick={() => deleteDraft(draft.id)}
                  >
                    🗑️ Delete
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <div className="result-actions">
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          ← Back to listings
        </button>
      </div>
    </section>
  );
}
