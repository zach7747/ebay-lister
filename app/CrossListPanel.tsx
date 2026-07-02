"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ItemGroup, Photo, PlatformStatus } from "@/lib/types";
import { mapToPoshmark, type PoshmarkMapped } from "@/lib/cross-list/poshmark";
import { mapToDepop, type DepopMapped } from "@/lib/cross-list/depop";

// ── Copy button (matches ListingCard pattern) ───────────────────────────────

function SmallCopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      className="btn-ghost cl-copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch { /* clipboard blocked */ }
      }}
    >
      {copied ? "✓" : "📋"}
    </button>
  );
}

// ── Field row ───────────────────────────────────────────────────────────────

function FieldRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="cl-field-row">
      <span className="cl-label">{label}</span>
      <span className="cl-value" title={value}>
        {value.length > 120 ? value.slice(0, 120) + "…" : value}
      </span>
      <SmallCopyButton text={value} label={label} />
    </div>
  );
}

// ── Platform sub-panel ──────────────────────────────────────────────────────

interface PlatformPanelProps {
  name: string;
  brandColor: string;
  fields: { label: string; value: string }[];
  platform: "poshmark" | "depop";
  group: ItemGroup;
  photos: Photo[];
  maxPhotos: number;
  onStatusChange: (groupId: string, platform: "poshmark" | "depop", status: PlatformStatus, url?: string) => void;
}

function PlatformPanel({
  name,
  brandColor,
  fields,
  platform,
  group,
  photos,
  maxPhotos,
  onStatusChange,
}: PlatformPanelProps) {
  const [urlInput, setUrlInput] = useState("");
  const status = group.crossList?.[platform]?.status ?? "idle";
  const url = group.crossList?.[platform]?.url;

  const copyAllText = useMemo(() => {
    return fields
      .filter((f) => f.value)
      .map((f) => `${f.label}: ${f.value}`)
      .join("\n");
  }, [fields]);

  const handleDownloadPhotos = useCallback(async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    const subset = photos.slice(0, maxPhotos);
    subset.forEach((photo, i) => {
      const ext = photo.mediaType.includes("png") ? "png" : "jpg";
      // Convert base64 to binary
      const binary = atob(photo.data);
      const bytes = new Uint8Array(binary.length);
      for (let j = 0; j < binary.length; j++) {
        bytes[j] = binary.charCodeAt(j);
      }
      zip.file(`photo_${i + 1}.${ext}`, bytes);
    });
    const blob = await zip.generateAsync({ type: "blob" });
    const saveAs = (await import("file-saver")).default;
    saveAs(blob, `${group.sku || group.name}_${platform}_photos.zip`);
  }, [photos, maxPhotos, group.sku, group.name, platform]);

  return (
    <div className="cl-platform" style={{ borderLeftColor: brandColor }}>
      <div className="cl-platform-head">
        <strong>{name}</strong>
        {status === "listed" && (
          <span className="cl-status cl-status-listed">
            ✓ Listed
            {url && (
              <>
                {" · "}
                <a href={url} target="_blank" rel="noopener noreferrer">
                  View ↗
                </a>
              </>
            )}
          </span>
        )}
        {status === "skipped" && (
          <span className="cl-status cl-status-skipped">Skipped</span>
        )}
      </div>

      <div className="cl-fields">
        {fields.map((f) => (
          <FieldRow key={f.label} label={f.label} value={f.value} />
        ))}
      </div>

      <div className="cl-actions">
        <button
          type="button"
          className="btn-ghost"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(copyAllText);
            } catch { /* blocked */ }
          }}
        >
          📋 Copy All
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={handleDownloadPhotos}
          disabled={photos.length === 0}
        >
          📁 Photos ({Math.min(photos.length, maxPhotos)})
        </button>
      </div>

      <div className="cl-status-row">
        {status === "idle" ? (
          <>
            <button
              type="button"
              className="btn-ghost cl-btn-listed"
              onClick={() => onStatusChange(group.id, platform, "listed")}
            >
              ✓ Mark Listed
            </button>
            <button
              type="button"
              className="btn-ghost cl-btn-skip"
              onClick={() => onStatusChange(group.id, platform, "skipped")}
            >
              Skip
            </button>
          </>
        ) : (
          <>
            <input
              type="text"
              className="cl-url-input"
              placeholder="Listing URL (optional)"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onBlur={() => {
                if (urlInput.trim()) {
                  onStatusChange(group.id, platform, status, urlInput.trim());
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && urlInput.trim()) {
                  onStatusChange(group.id, platform, status, urlInput.trim());
                }
              }}
            />
            <button
              type="button"
              className="btn-ghost cl-btn-reset"
              onClick={() => {
                setUrlInput("");
                onStatusChange(group.id, platform, "idle");
              }}
            >
              Reset
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main panel ──────────────────────────────────────────────────────────────

interface CrossListPanelProps {
  group: ItemGroup;
  photoById: (id: string) => Photo | undefined;
  onCrossListStatusChange: (groupId: string, platform: "poshmark" | "depop", status: PlatformStatus, url?: string) => void;
}

export function CrossListPanel({
  group,
  photoById,
  onCrossListStatusChange,
}: CrossListPanelProps) {
  const [open, setOpen] = useState(false);
  const listing = group.listing;
  if (!listing) return null;

  const photos = useMemo(
    () =>
      group.photoIds
        .map((id) => photoById(id))
        .filter((p): p is Photo => Boolean(p)),
    [group.photoIds, photoById]
  );

  const poshmark = mapToPoshmark(listing);
  const depop = mapToDepop(listing);

  const poshmarkFields: { label: string; value: string }[] = [
    { label: "Title", value: poshmark.title },
    { label: "Description", value: poshmark.description },
    { label: "Category", value: poshmark.category },
    { label: "Subcategory", value: poshmark.subcategory },
    { label: "Brand", value: poshmark.brand },
    { label: "Size", value: poshmark.size },
    { label: "Condition", value: poshmark.condition },
    { label: "Price", value: `$${poshmark.price.toFixed(2)}` },
    { label: "Color", value: poshmark.color },
  ];

  const depopFields: { label: string; value: string }[] = [
    { label: "Title", value: depop.title },
    { label: "Description", value: depop.description },
    { label: "Category", value: depop.category },
    { label: "Brand", value: depop.brand },
    { label: "Size", value: depop.size },
    { label: "Condition", value: depop.condition },
    { label: "Price", value: `$${depop.price.toFixed(2)}` },
    { label: "Color", value: depop.color },
  ];

  const poshmarkStatus = group.crossList?.poshmark?.status ?? "idle";
  const depopStatus = group.crossList?.depop?.status ?? "idle";
  const hasActivity = poshmarkStatus !== "idle" || depopStatus !== "idle";

  return (
    <div className="cl-panel">
      <button
        type="button"
        className="cl-header"
        onClick={() => setOpen((o) => !o)}
      >
        <span>{open ? "▾" : "▸"} Cross-List</span>
        {hasActivity && (
          <span className="cl-activity">
            {poshmarkStatus === "listed" && "PM ✓"}
            {poshmarkStatus === "listed" && depopStatus === "listed" && " · "}
            {depopStatus === "listed" && "Depop ✓"}
            {poshmarkStatus === "skipped" && "PM –"}
            {poshmarkStatus === "skipped" && depopStatus === "skipped" && " · "}
            {depopStatus === "skipped" && "Depop –"}
          </span>
        )}
      </button>

      {open && (
        <div className="cl-body">
          <PlatformPanel
            name="Poshmark"
            brandColor="#c4395d"
            fields={poshmarkFields}
            platform="poshmark"
            group={group}
            photos={photos}
            maxPhotos={16}
            onStatusChange={onCrossListStatusChange}
          />
          <PlatformPanel
            name="Depop"
            brandColor="#ff2300"
            fields={depopFields}
            platform="depop"
            group={group}
            photos={photos}
            maxPhotos={4}
            onStatusChange={onCrossListStatusChange}
          />
        </div>
      )}
    </div>
  );
}
