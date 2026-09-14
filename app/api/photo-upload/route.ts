// Upload a batch of listing photos to Vercel Blob so /api/analyze can pull
// them by reference instead of carrying the bytes in its request body.
//
// Why this exists: Vercel Functions cap request bodies at 4.5 MB, so a 42-photo
// item (~15 MB of base64) cannot be analyzed in one inline POST. The client
// splits the photos into small batches, stores each batch here, then calls
// /api/analyze with photoRefs (pathnames). The analyze route fetches each blob
// at FULL resolution, so nothing is ever shrunk to fit the body cap.
//
// Auth: same pattern as lib/instructions-store.ts — BLOB_READ_WRITE_TOKEN (or
// BLOB_STORE_ID) is already set in Production/Preview/Development.
//
// Fail-soft: if there are no blob credentials we answer stored:false so the
// client falls back to the inline (shrunk) path. A single malformed request
// is a 400; a too-large batch is a 413 (client is expected to size batches;
// this is a guard, not a negotiation point).

import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { guardApiRequest } from "@/lib/api-guard";
import { logError, logInfo } from "@/lib/logger";

export const dynamic = "force-dynamic";

// Keep each batch comfortably under the 4.5 MB function body cap. The client
// targets 3.2 MB of base64 per batch; this server-side guard is a coarser
// safety net in case a client sends more than it thinks it has.
const MAX_BATCH_BASE64_BYTES = 3_600_000;

interface UploadPhoto {
  id: string;
  mediaType: string;
  data: string; // base64, no data: prefix
}

interface UploadBody {
  batchId: string;
  photos: UploadPhoto[];
}

function hasCredentials(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID
  );
}

// Pathname segment sanity: photo ids come from the client, and the id is
// spliced straight into a blob pathname. Reject anything that is not a
// conservative identifier so we can never escape the listing-photos/ tree or
// inject a slash into the path.
function safePathSegment(seg: string): string | null {
  if (typeof seg !== "string" || seg.length === 0 || seg.length > 128) {
    return null;
  }
  if (!/^[A-Za-z0-9._-]+$/.test(seg)) return null;
  return seg;
}

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  // No blob credentials → tell the client to fall back to inline images.
  if (!hasCredentials()) {
    return NextResponse.json({ ok: true, stored: false });
  }

  let body: UploadBody;
  try {
    body = (await req.json()) as UploadBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 }
    );
  }

  if (
    !body ||
    typeof body.batchId !== "string" ||
    !Array.isArray(body.photos) ||
    body.photos.length === 0
  ) {
    return NextResponse.json(
      { ok: false, error: "batchId and a non-empty photos[] are required." },
      { status: 400 }
    );
  }

  const batchId = safePathSegment(body.batchId);
  if (!batchId) {
    return NextResponse.json(
      { ok: false, error: "batchId contains invalid characters." },
      { status: 400 }
    );
  }

  // Guard: refuse a batch whose base64 is too big. The client is supposed to
  // size batches itself; this only trips if it misbehaves.
  const base64Total = body.photos.reduce(
    (sum, p) => sum + (typeof p.data === "string" ? p.data.length : 0),
    0
  );
  if (base64Total > MAX_BATCH_BASE64_BYTES) {
    logInfo(
      "/api/photo-upload",
      `Rejected batch ${batchId}: ${base64Total} base64 chars > ${MAX_BATCH_BASE64_BYTES}`
    );
    return NextResponse.json(
      { ok: false, error: "batch too large" },
      { status: 413 }
    );
  }

  const pathnames: string[] = [];
  try {
    for (const photo of body.photos) {
      const id = safePathSegment(photo?.id ?? "");
      if (!id) {
        return NextResponse.json(
          { ok: false, error: `Photo id "${photo?.id}" is invalid.` },
          { status: 400 }
        );
      }
      const data = photo.data;
      if (typeof data !== "string" || data.length === 0) {
        return NextResponse.json(
          { ok: false, error: `Photo ${id} has no data.` },
          { status: 400 }
        );
      }

      const pathname = `listing-photos/${batchId}/${id}.jpg`;
      const result = await put(pathname, Buffer.from(data, "base64"), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "image/jpeg",
      });
      // Trust the server-assigned pathname over our local string so the
      // pathnames we return are exactly what analyze will be able to read.
      pathnames.push(result.pathname);
    }
  } catch (e) {
    logError("/api/photo-upload", `Failed to store batch ${batchId}`, e);
    return NextResponse.json(
      { ok: false, error: "Failed to store photo batch." },
      { status: 500 }
    );
  }

  logInfo(
    "/api/photo-upload",
    `Stored ${pathnames.length} photos for batch ${batchId}`
  );
  return NextResponse.json({ ok: true, stored: true, pathnames });
}
