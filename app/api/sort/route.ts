import { NextRequest, NextResponse } from "next/server";
import { getClient, LLMAuthError } from "@/lib/llm";
import { guardApiRequest, safeErrorResponse } from "@/lib/api-guard";
import { sortPhotos } from "@/lib/sortPipeline";
import { logError, logInfo, logWarn } from "@/lib/logger";
import type { WireImage } from "@/lib/images";

// Sorting makes several model calls across grouping/verify/merge stages.
export const maxDuration = 120;

const MAX_PHOTOS = 120;

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  let body: { images?: WireImage[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 }
    );
  }

  const images = Array.isArray(body.images) ? body.images.slice(0, MAX_PHOTOS) : [];
  if (images.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Please add some photos first." },
      { status: 400 }
    );
  }

  logInfo("/api/sort", `Sorting ${images.length} photos`);

  let client;
  try {
    client = getClient();
  } catch (e) {
    logError("/api/sort", "LLM client init failed", e);
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 }
    );
  }

  try {
    const result = await sortPhotos(client, images);
    if (result.groups.length === 0) {
      logWarn("/api/sort", "Sort returned 0 groups", { photoCount: images.length });
      return NextResponse.json(
        { ok: false, error: "Couldn't sort these photos. Try fewer at a time." },
        { status: 502 }
      );
    }
    logInfo("/api/sort", `Sorted into ${result.groups.length} groups`);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof LLMAuthError) {
      logError("/api/sort", `Auth/billing failure: ${e.message}`, e);
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    logError("/api/sort", "Sorting failed", e, { photoCount: images.length });
    return safeErrorResponse("sort", e, "Sorting failed — please try again.");
  }
}
