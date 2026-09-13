import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { guardApiRequest } from "@/lib/api-guard";
import { DEFAULT_LISTING_INSTRUCTIONS } from "@/lib/default-instructions";
import {
  readStoredInstructions,
  writeStoredInstructions,
} from "@/lib/instructions-store";

// Local (non-Vercel) fallback file. On Vercel this path does not exist, so the
// local fallback simply resolves to the baked-in default.
const DIR = join(process.env.HOME || "/root", "ebay-lister-drafts");
const FILE = join(DIR, "instructions.txt");

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  try {
    // 1) Persistent blob store — the source of truth on Vercel.
    const stored = await readStoredInstructions();
    if (stored) {
      return NextResponse.json({ ok: true, text: stored });
    }

    // 2) Local file (HOME path) when it exists and is non-empty — unchanged
    //    local-dev behaviour.
    let local = "";
    if (existsSync(FILE)) {
      local = readFileSync(FILE, "utf-8");
    }
    if (local && local.trim()) {
      return NextResponse.json({ ok: true, text: local });
    }

    // 3) Baked-in default.
    return NextResponse.json({ ok: true, text: DEFAULT_LISTING_INSTRUCTIONS });
  } catch {
    return NextResponse.json({ ok: true, text: DEFAULT_LISTING_INSTRUCTIONS });
  }
}

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  let text = "";
  try {
    const body = await req.json();
    text = String(body?.text ?? "");
  } catch {
    return NextResponse.json({ ok: true, persisted: false });
  }

  // Never clobber the stored value with an empty/whitespace string.
  if (!text.trim()) {
    return NextResponse.json({ ok: true, persisted: false });
  }

  // Persist to the blob store (source of truth on Vercel).
  const persisted = await writeStoredInstructions(text);

  // Keep the local file in sync when NOT on Vercel, so local behaviour is
  // unchanged. A local write failure must never surface as an error.
  if (!process.env.VERCEL) {
    try {
      mkdirSync(dirname(FILE), { recursive: true });
      writeFileSync(FILE, text, "utf-8");
    } catch {
      // ignore — the blob result is what we report
    }
  }

  // A failed blob write must not 500 the UI — edits just won't persist.
  return NextResponse.json({ ok: true, persisted });
}
