"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ItemGroup, ListingResult, Photo, ShippingOption } from "@/lib/types";
import type { PlatformStatus } from "@/lib/types";
import { CrossListPanel } from "./CrossListPanel";

// Progress simulation for the writing state.
// Typical analysis: ~2-3s routing + ~15-30s image analysis + ~3s parse.
const WRITE_STEPS = [
  { pct: 12, label: "Identifying item type…" },
  { pct: 35, label: "Analyzing photos…" },
  { pct: 60, label: "Writing listing…" },
  { pct: 82, label: "Generating specifics…" },
  { pct: 92, label: "Finalizing…" },
];

function useWriteProgress(status: ItemGroup["status"]) {
  const [pct, setPct] = useState(0);
  const [stepLabel, setStepLabel] = useState("");
  const startRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    if (status !== "writing") {
      if (status === "done" && pct > 0) {
        // Snap to 100% briefly, then stop.
        setPct(100);
        setStepLabel("Complete");
      }
      return;
    }

    startRef.current = Date.now();
    const TOTAL_DURATION = 35_000; // 35s expected total

    const tick = () => {
      const elapsed = Date.now() - startRef.current;
      const raw = Math.min(elapsed / TOTAL_DURATION, 0.95);
      // Ease-out curve: fast start, slow finish
      const eased = 1 - Math.pow(1 - raw, 2.5);
      const currentPct = Math.round(eased * 92);
      setPct(currentPct);

      // Find current step label
      for (let i = WRITE_STEPS.length - 1; i >= 0; i--) {
        if (currentPct >= WRITE_STEPS[i].pct - 5) {
          setStepLabel(WRITE_STEPS[i].label);
          break;
        }
      }

      if (raw < 0.95) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  return { pct, stepLabel };
}

const TITLE_LIMIT = 80;

// eBay's pre-owned condition tiers, matching the values the model returns.
const CONDITIONS: { value: string; label: string }[] = [
  { value: "NEW_WITH_TAGS", label: "New with tags" },
  { value: "NEW_NO_TAGS", label: "New without tags" },
  { value: "EXCELLENT", label: "Pre-owned · Excellent" },
  { value: "VERY_GOOD", label: "Pre-owned · Very good" },
  { value: "GOOD", label: "Pre-owned · Good" },
  { value: "FAIR", label: "Pre-owned · Fair" },
];

const SHIPPING_OPTIONS: { value: ShippingOption; label: string; detail: string }[] = [
  { value: "light", label: "Up to 8 oz — $6.95", detail: "USPS Ground (≤8 oz)" },
  { value: "medium", label: "9–16 oz — $8.99", detail: "USPS Ground (9–16 oz)" },
  { value: "heavy", label: "1–2 lbs — $11.79", detail: "USPS Ground (1–2 lbs)" },
];

function formatPrice(value: ListingResult["suggested_price"]): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (n === undefined || Number.isNaN(n)) return "$0.00";
  return `$${n.toFixed(2)}`;
}

function priceToInput(value: ListingResult["suggested_price"]): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return n === undefined || Number.isNaN(n) ? "" : String(n);
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      className="btn-ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {copied ? "✓ Copied" : `📋 Copy ${label}`}
    </button>
  );
}

interface ListingCardProps {
  group: ItemGroup;
  photoById: (id: string) => Photo | undefined;
  ebayConnected: boolean;
  onEdit: (groupId: string, patch: Partial<ListingResult>) => void;
  onRetry: (groupId: string) => void;
  onPost: (groupId: string) => void;
  onShippingChange?: (groupId: string, option: ShippingOption) => void;
  onCrossListStatusChange?: (groupId: string, platform: "poshmark" | "depop", status: PlatformStatus, url?: string) => void;
}

export function ListingCard({
  group,
  photoById,
  ebayConnected,
  onEdit,
  onRetry,
  onPost,
  onShippingChange,
  onCrossListStatusChange,
}: ListingCardProps) {
  const [open, setOpen] = useState(true);
  const listing = group.listing;
  const cover = photoById(group.photoIds[0]);
  const { pct, stepLabel } = useWriteProgress(group.status);

  const specifics = useMemo(() => {
    const entries = Object.entries(listing?.item_specifics ?? {});
    return entries.filter(([k, v]) => v != null && String(v).trim() !== "" && !k.startsWith("---"));
  }, [listing?.item_specifics]);

  const titleLen = listing?.title?.length ?? 0;

  return (
    <article className={`listing-card status-${group.status}`}>
      <header className="listing-card-head">
        <button
          type="button"
          className="listing-card-toggle"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {cover && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="listing-cover" src={cover.previewUrl} alt="" />
          )}
          <span className="listing-card-title">
            <strong>
              {group.sku && <span className="sku-tag">{group.sku}</span>}
              {listing?.title || group.name}
            </strong>
            <span className="listing-card-sub">
              {group.status === "writing" && (
                <span className="write-step-label">{stepLabel}</span>
              )}
              {group.status === "done" && (
                <>✅ {formatPrice(listing?.suggested_price)} · ready</>
              )}
              {group.status === "error" && (
                <span style={{ color: "var(--color-danger)" }}>
                  ⚠️ {group.error || "Failed"}
                </span>
              )}
              {group.status === "idle" && "Waiting…"}
            </span>
          </span>
          {group.status !== "error" && (
            <span className="chevron" aria-hidden="true">
              {open ? "▾" : "▸"}
            </span>
          )}
        </button>
        {group.status === "error" ? (
          <button
            type="button"
            className="btn-ghost"
            onClick={(e) => {
              onRetry(group.id);
            }}
          >
            ↻ Retry
          </button>
        ) : null}
      </header>

      {(group.status === "writing" || (group.status === "done" && pct > 0)) && (
        <div
          className="write-progress-track"
          role="progressbar"
          aria-label="Listing writing progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={group.status === "writing" ? undefined : pct}
        >
          <div
            className={`write-progress-bar${group.status === "done" ? " done" : ""}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {open && listing && group.status === "done" && (
        <div className="listing-card-body">
          <div className="result-field">
            <label>
              Title
              <span className={`count${titleLen > TITLE_LIMIT ? " over" : ""}`}>
                {titleLen}/{TITLE_LIMIT}
              </span>
            </label>
            <textarea
              className="title-input"
              value={listing.title}
              onChange={(e) => onEdit(group.id, { title: e.target.value })}
              rows={2}
            />
            <div className="copy-row">
              <CopyButton text={listing.title} label="title" />
            </div>
          </div>

          <div className="meta-row">
            <div className="stat editable">
              <label className="k" htmlFor={`price-${group.id}`}>
                Price
              </label>
              <div className="price-input">
                <span aria-hidden="true">$</span>
                <input
                  id={`price-${group.id}`}
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={priceToInput(listing.suggested_price)}
                  onChange={(e) =>
                    onEdit(group.id, {
                      suggested_price:
                        e.target.value === "" ? "" : Number(e.target.value),
                    })
                  }
                />
              </div>
            </div>
            <div className="stat editable">
              <label className="k" htmlFor={`cond-${group.id}`}>
                Condition
              </label>
              <select
                id={`cond-${group.id}`}
                value={listing.condition ?? "GOOD"}
                onChange={(e) => onEdit(group.id, { condition: e.target.value })}
              >
                {/* Keep an unexpected model value selectable rather than losing it. */}
                {listing.condition &&
                  !CONDITIONS.some((c) => c.value === listing.condition) && (
                    <option value={listing.condition}>
                      {listing.condition.replace(/_/g, " ")}
                    </option>
                  )}
                {CONDITIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="stat editable">
              <label className="k" htmlFor={`ship-${group.id}`}>
                Shipping
              </label>
              <select
                id={`ship-${group.id}`}
                value={group.shippingOption ?? "light"}
                onChange={(e) =>
                  onShippingChange?.(group.id, e.target.value as ShippingOption)
                }
              >
                {SHIPPING_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            {listing.brand && (
              <div className="stat">
                <div className="k">Brand</div>
                <div className="v">{listing.brand}</div>
              </div>
            )}
            {listing.size && (
              <div className="stat">
                <div className="k">Size</div>
                <div className="v">{listing.size}</div>
              </div>
            )}
          </div>

          <div className="result-field">
            <label>Description</label>
            <textarea
              value={listing.description}
              onChange={(e) => onEdit(group.id, { description: e.target.value })}
              rows={8}
            />
            <div className="copy-row">
              <CopyButton text={listing.description} label="description" />
            </div>
          </div>

          {specifics.length > 0 && (
            <details className="specifics-details">
              <summary>{specifics.length} item specifics</summary>
              <div className="specifics">
                {specifics.map(([k, v]) => (
                  <div className="row" key={k}>
                    <span className="k">{k}</span>
                    <span>{v}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* eBay posting */}
          {group.postStatus === "posted" ? (
            <p className="post-result ok">
              ✅ Posted to eBay
              {group.listingId ? (
                <>
                  {" "}
                  ·{" "}
                  <a
                    href={`https://www.ebay.com/itm/${group.listingId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View listing ↗
                  </a>
                </>
              ) : null}
            </p>
          ) : (
            <div className="post-row" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onPost(group.id)}
                disabled={group.postStatus === "posting"}
              >
                {group.postStatus === "posting" ? (
                  <>
                    <span className="spinner" aria-hidden="true" /> Posting to eBay…
                  </>
                ) : (
                  "🚀 Publish to eBay"
                )}
              </button>
              {group.postStatus === "error" && group.postError && (
                <p className="post-result err" style={{ width: "100%" }}>⚠️ {group.postError}</p>
              )}
            </div>
          )}
        </div>
      )}

      {open && listing && group.status === "done" && onCrossListStatusChange && (
        <CrossListPanel
          group={group}
          photoById={photoById}
          onCrossListStatusChange={onCrossListStatusChange}
        />
      )}
    </article>
  );
}
