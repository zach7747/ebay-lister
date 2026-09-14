import { NextRequest, NextResponse } from "next/server";
import type OpenAI from "openai";
import { getClient, parseModelJson, LLMAuthError, llmAuthError } from "@/lib/llm";
import { guardApiRequest } from "@/lib/api-guard";
import {
  PROFILE_ROUTER_PROMPT,
  buildProfiledAnalysisPrompt,
  normalizeItemProfile,
} from "@/lib/prompts";
import { toImageBlock, type ImageBlock, type ChatContentPart } from "@/lib/images";
import { logError, logInfo } from "@/lib/logger";
import { get, del } from "@vercel/blob";
import type { AnalyzeRequestBody, ListingResult } from "@/lib/types";

// Analysis can take 20-40s for a multi-photo item. Give it room.
export const maxDuration = 60;

const ANALYSIS_MODEL = "anthropic/claude-sonnet-4";
const ROUTER_MODEL = "anthropic/claude-haiku-4.5";
const MAX_IMAGES = 12;

function toImageBlocks(images: AnalyzeRequestBody["images"]): ImageBlock[] {
  const blocks: ImageBlock[] = [];
  for (const img of images.slice(0, MAX_IMAGES)) {
    const block = toImageBlock(img);
    if (block) blocks.push(block);
  }
  return blocks;
}

// Mirrors route_item_profile(): honor a forced profile, else ask the model.
async function routeProfile(
  client: OpenAI,
  imageBlocks: ImageBlock[],
  requested: string
): Promise<string> {
  const forced = normalizeItemProfile(requested);
  if (forced !== "auto") return forced;

  try {
    const resp = await client.chat.completions.create({
      model: ROUTER_MODEL,
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: [
            ...imageBlocks,
            { type: "text", text: PROFILE_ROUTER_PROMPT },
          ] as OpenAI.ChatCompletionContentPart[],
        },
      ],
    });
    const text = firstText(resp);
    const data = parseModelJson<{ profile?: string }>(text);
    const routed = normalizeItemProfile(data?.profile ?? "auto");
    return routed !== "auto" ? routed : "hard_goods";
  } catch (e) {
    // Auth/billing failures must surface, not silently fall back to a profile.
    const fatal = llmAuthError(e);
    if (fatal) throw fatal;
    logError("/api/analyze", "Profile routing failed, defaulting to hard_goods", e);
    return "hard_goods";
  }
}

function firstText(resp: OpenAI.ChatCompletion): string {
  return resp.choices?.[0]?.message?.content?.trim() ?? "";
}

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  let body: AnalyzeRequestBody;
  try {
    body = (await req.json()) as AnalyzeRequestBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 }
    );
  }

  const refList = Array.isArray(body.photoRefs)
    ? body.photoRefs.filter(
        (r): r is string => typeof r === "string" && r.length > 0
      )
    : [];
  const hasInline = Array.isArray(body.images) && body.images.length > 0;

  // Count of photoRefs successfully fetched from blob storage. Always present
  // in the JSON response (success and failure paths) so the transport can be
  // verified with curl: refsResolved > 0 proves the blob was read end-to-end.
  let refsResolved = 0;

  let imageBlocks: ImageBlock[];
  if (refList.length > 0) {
    // Pull each photo from the private blob store at FULL resolution. The
    // client split the photos into these small upload jobs precisely so no
    // single /api/analyze request body ever approaches the 4.5 MB cap.
    const resolved: { mediaType: string; data: string }[] = [];
    for (const ref of refList) {
      try {
        const result = await get(ref, { access: "private", useCache: false });
        if (result && result.statusCode === 200 && result.stream) {
          const bytes = await new Response(result.stream).arrayBuffer();
          resolved.push({
            mediaType: "image/jpeg",
            data: Buffer.from(bytes).toString("base64"),
          });
        }
      } catch (e) {
        logError("/api/analyze", `Failed to fetch blob ref ${ref}`, e);
      }
    }
    refsResolved = resolved.length;

    // Best-effort cleanup: these blobs are one-shot, so delete them right after
    // they are read. Cleanup must never affect the response.
    try {
      if (refList.length > 0) await del(refList);
    } catch (e) {
      logError("/api/analyze", "Blob cleanup after analyze failed", e);
    }

    imageBlocks = toImageBlocks(resolved);
    // If every ref failed to resolve, fall back to the inline images path
    // rather than hard-failing just because the refs broke.
    if (imageBlocks.length === 0 && hasInline) {
      imageBlocks = toImageBlocks(body.images);
    }
  } else {
    if (!hasInline) {
      return NextResponse.json(
        { ok: false, error: "Please add at least one photo." },
        { status: 400 }
      );
    }
    imageBlocks = toImageBlocks(body.images);
  }

  if (imageBlocks.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "No readable photos found. Use JPG, PNG, or WebP.",
        refsResolved,
      },
      { status: 400 }
    );
  }

  let client: OpenAI;
  try {
    client = getClient();
  } catch (e) {
    logError("/api/analyze", "LLM client init failed", e);
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 }
    );
  }

  try {
    const profile = await routeProfile(client, imageBlocks, body.profile);
    let systemPrompt = buildProfiledAnalysisPrompt(profile);

    // Inject user's custom listing instructions (SEO keywords, tone, etc.)
    if (body.customInstructions?.trim()) {
      systemPrompt += `\n\nCUSTOM LISTING INSTRUCTIONS (follow these above all else):\n${body.customInstructions.trim()}`;
    }

    logInfo("/api/analyze", `Analyzing ${imageBlocks.length} images (profile: ${profile})`);

    // Retry up to 3 times
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const resp = await client.chat.completions.create({
          model: ANALYSIS_MODEL,
          max_tokens: 3000,
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: [
                ...imageBlocks,
                {
                  type: "text",
                  text: "Analyze these photos and return the listing JSON now.",
                },
              ] as OpenAI.ChatCompletionContentPart[],
            },
          ],
        });
        const listing = parseModelJson<ListingResult>(firstText(resp));
        listing.item_profile = profile;
        logInfo("/api/analyze", `Listing written: "${listing.title}"`);
        return NextResponse.json({ ok: true, listing, refsResolved });
      } catch (err) {
        const fatal = llmAuthError(err);
        if (fatal) throw fatal;
        lastErr = err;
        if (attempt < 2) {
          logError(`/api/analyze`, `Attempt ${attempt + 1} failed, retrying`, err);
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
    }
    throw lastErr;
  } catch (e) {
    if (e instanceof LLMAuthError) {
      logError("/api/analyze", `Auth/billing failure: ${e.message}`, e);
      return NextResponse.json(
        { ok: false, error: e.message, refsResolved },
        { status: e.status }
      );
    }
    logError("/api/analyze", "Analysis failed after retries", e);
    // Inlined (was safeErrorResponse) so refsResolved rides along on this
    // failure path too — it is the transport proof that blobs were read even
    // when the LLM call itself errors.
    console.error("[analyze]", e);
    return NextResponse.json(
      {
        ok: false,
        error: "Something went wrong analyzing photos — please try again.",
        refsResolved,
      },
      { status: 500 }
    );
  }
}
