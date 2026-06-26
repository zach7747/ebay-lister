"use client";

import { ListingCard } from "./ListingCard";
import {
  downloadFile,
  listingsToCsv,
  listingsToJson,
} from "@/lib/export";
import type { ItemGroup, ListingResult, Photo } from "@/lib/types";

interface ListingsViewProps {
  groups: ItemGroup[];
  photoById: (id: string) => Photo | undefined;
  ebayConnected: boolean;
  onEdit: (groupId: string, patch: Partial<ListingResult>) => void;
  onRetry: (groupId: string) => void;
  onPost: (groupId: string) => void;
  onPostAll: () => void;
  onSaveToDraft?: (groupId: string) => void;
  onSaveAllToDrafts?: () => void;
  savedDraftIds?: Set<string>;
  onShowDrafts?: () => void;
  onBack: () => void;
}

export function ListingsView({
  groups,
  photoById,
  ebayConnected,
  onEdit,
  onRetry,
  onPost,
  onPostAll,
  onSaveToDraft,
  onSaveAllToDrafts,
  savedDraftIds,
  onShowDrafts,
  onBack,
}: ListingsViewProps) {
  const done = groups.filter((g) => g.status === "done").length;
  const writing = groups.filter((g) => g.status === "writing").length;
  const failed = groups.filter((g) => g.status === "error").length;
  const posted = groups.filter((g) => g.postStatus === "posted").length;
  const posting = groups.some((g) => g.postStatus === "posting");
  const readyToPost = groups.filter(
    (g) => g.status === "done" && g.postStatus !== "posted"
  ).length;
  const allDone = writing === 0 && done > 0;

  return (
    <section className="panel" aria-labelledby="listings-heading">
      <div className="result-head">
        <h3 id="listings-heading">Your listings</h3>
        <span className="badge">
          {done}/{groups.length} ready
          {writing > 0 ? ` · ${writing} writing` : ""}
          {failed > 0 ? ` · ${failed} failed` : ""}
          {posted > 0 ? ` · ${posted} posted` : ""}
        </span>
      </div>

      {readyToPost > 0 && (
        <div className="post-all-bar">
          <span>
            {posted > 0
              ? `${posted} posted · ${readyToPost} left`
              : `${readyToPost} listing${readyToPost > 1 ? "s" : ""} ready`}
          </span>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {onSaveAllToDrafts && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onSaveAllToDrafts}
              >
                💾 Save all to Drafts
              </button>
            )}
            {ebayConnected && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={onPostAll}
                disabled={posting}
              >
                {posting ? (
                  <>
                    <span className="spinner" aria-hidden="true" /> Posting…
                  </>
                ) : (
                  `🚀 Publish all ${readyToPost} to eBay`
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon" aria-hidden="true">✨</span>
          <span style={{ fontSize: 28, marginBottom: 12, opacity: 0.7 }}>📦 ✓</span>
          <h4>No listings yet</h4>
          <p>Upload photos to get started</p>
        </div>
      ) : (
        <div className="listing-list">
          {groups.map((group) => (
            <ListingCard
              key={group.id}
              group={group}
              photoById={photoById}
              ebayConnected={ebayConnected}
              onEdit={onEdit}
              onRetry={onRetry}
              onPost={onPost}
              onSaveToDraft={onSaveToDraft}
              draftSaved={savedDraftIds?.has(group.id)}
            />
          ))}
        </div>
      )}

      <div className="action-rows">
        <button type="button" className="action-row" onClick={onBack}>
          <span className="row-icon">←</span>
          <span className="row-text">
            <span className="row-title">Back to items</span>
            <span className="row-sub">Return to your uploaded items</span>
          </span>
          <span className="row-chevron">›</span>
        </button>
        {onShowDrafts && (
          <button type="button" className="action-row" onClick={onShowDrafts}>
            <span className="row-icon">📄</span>
            <span className="row-text">
              <span className="row-title">View Drafts</span>
              <span className="row-sub">Continue working on drafts</span>
            </span>
            <span className="row-chevron">›</span>
          </button>
        )}
        <button
          type="button"
          className="action-row"
          disabled={done === 0}
          onClick={() =>
            downloadFile(
              "ebay-listings.csv",
              listingsToCsv(groups),
              "text/csv"
            )
          }
        >
          <span className="row-icon">⬇️</span>
          <span className="row-text">
            <span className="row-title">Download spreadsheet (CSV)</span>
            <span className="row-sub">Export your listings</span>
          </span>
          <span className="row-chevron">›</span>
        </button>
      </div>

      <button
        type="button"
        className="btn-cta"
        disabled={done === 0}
        onClick={() =>
          downloadFile(
            "ebay-listings.json",
            listingsToJson(groups),
            "application/json"
          )
        }
      >
        ⬇️ Download all ({done})
      </button>

      {allDone && (
        <p className="footnote" style={{ marginTop: "1.5rem" }}>
          Next phase: post all of these straight to eBay with one click.
        </p>
      )}
    </section>
  );
}
