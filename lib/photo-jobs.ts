"use client";

// Client-side "photo jobs" transport for /api/analyze.
//
// A big item (40+ photos, ~15 MB of base64) cannot be analyzed in one inline
// POST because Vercel Functions cap request bodies at 4.5 MB. Instead of
// shrinking the photos (see payload-budget.ts, the last-resort fallback), we
// split the FULL-resolution photos into small batches and store each batch via
// POST /api/photo-upload (→ Vercel Blob). We then call /api/analyze with
// photoRefs (blob pathnames) and no images array. analyze pulls every blob at
// full resolution, so nothing is ever degraded to fit the body cap.
//
// This module owns the batching + sequential upload. It is fail-soft: any
// problem returns null so the caller falls back to the existing inline path.

import { apiPost } from "./api-client";

export interface PhotoJobImage {
  mediaType: string;
  data: string; // base64, no data: prefix
}

interface UploadResponse {
  ok: boolean;
  stored?: boolean;
  pathnames?: string[];
  error?: string;
}

// Cap the base64 total per batch. Base64 is stored verbatim in the JSON body
// (no escaping), so 3.0 MB of base64 ≈ 3.05 MB serialized once ids, media
// types, and punctuation are added — comfortably under the 4.5 MB cap.
const BATCH_BASE64_BUDGET = 3_000_000;

async function parseJson(res: Response): Promise<UploadResponse> {
  const text = await res.text();
  try {
    return JSON.parse(text) as UploadResponse;
  } catch {
    return { ok: false, error: `photo upload failed (${res.status}).` };
  }
}

/**
 * Split `images` into small batches (base64 total <= BATCH_BASE64_BUDGET),
 * upload each to /api/photo-upload sequentially, and return the blob
 * pathnames in the SAME order as `images`.
 *
 * Returns null when: there are no images, any batch fails (network error,
 * non-ok response, stored:false, or a pathname-count mismatch), or the store
 * reports no credentials (stored:false). The caller must then fall back to
 * the inline (shrunk) analyze path. Never throws.
 */
export async function uploadPhotoJobs(
  groupId: string,
  images: PhotoJobImage[]
): Promise<string[] | null> {
  if (!images || images.length === 0) return null;

  // Greedy batching on base64 byte total, preserving order.
  const batches: PhotoJobImage[][] = [];
  let current: PhotoJobImage[] = [];
  let currentBytes = 0;
  for (const img of images) {
    const len = img.data?.length ?? 0;
    if (current.length > 0 && currentBytes + len > BATCH_BASE64_BUDGET) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(img);
    currentBytes += len;
  }
  if (current.length > 0) batches.push(current);

  const now = Date.now();
  const pathnames: string[] = [];

  for (let i = 0; i < batches.length; i++) {
    const batchId = `${groupId}-${now}-${i}`;
    let res: Response;
    try {
      res = await apiPost("/api/photo-upload", {
        batchId,
        photos: batches[i].map((p, idx) => ({
          id: `${i}-${idx}`,
          mediaType: p.mediaType,
          data: p.data,
        })),
      });
    } catch {
      // fetch itself threw (offline, etc.) — fall back to inline.
      return null;
    }
    const data = await parseJson(res);
    if (
      !data.ok ||
      data.stored !== true ||
      !Array.isArray(data.pathnames) ||
      data.pathnames.length !== batches[i].length
    ) {
      return null;
    }
    pathnames.push(...data.pathnames);
  }

  return pathnames.length === images.length ? pathnames : null;
}
