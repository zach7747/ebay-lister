import { NextRequest, NextResponse } from "next/server";
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  existsSync,
  mkdirSync,
} from "fs";
import { join } from "path";
import { guardApiRequest } from "@/lib/api-guard";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const DRAFTS_DIR = join(process.env.HOME || "/root", "ebay-lister-saved-drafts");

function ensureDir() {
  mkdirSync(DRAFTS_DIR, { recursive: true });
}

function draftPath(id: string): string {
  // Sanitize id to prevent path traversal
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "");
  return join(DRAFTS_DIR, `${safe}.json`);
}

function loadAllDrafts(): any[] {
  ensureDir();
  const files = readdirSync(DRAFTS_DIR).filter((f) => f.endsWith(".json"));
  const drafts: any[] = [];
  for (const f of files) {
    try {
      const data = JSON.parse(readFileSync(join(DRAFTS_DIR, f), "utf-8"));
      drafts.push(data);
    } catch {
      // skip corrupted files
    }
  }
  // Sort newest first
  drafts.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return drafts;
}

/** GET — list all saved drafts */
export async function GET(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  try {
    const drafts = loadAllDrafts();
    return NextResponse.json({ ok: true, drafts });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 }
    );
  }
}

/** POST — save or update a draft */
export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  try {
    const body = await req.json();
    if (!body || !body.id) {
      return NextResponse.json(
        { ok: false, error: "Draft must have an id." },
        { status: 400 }
      );
    }
    ensureDir();

    // If draft already exists, merge (preserve createdAt)
    let existing: any = null;
    const p = draftPath(body.id);
    if (existsSync(p)) {
      try { existing = JSON.parse(readFileSync(p, "utf-8")); } catch {}
    }

    const draft = {
      ...body,
      createdAt: existing?.createdAt || body.createdAt || Date.now(),
      updatedAt: Date.now(),
    };

    writeFileSync(p, JSON.stringify(draft), "utf-8");
    return NextResponse.json({ ok: true, draft });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 }
    );
  }
}

/** DELETE — delete a draft by id */
export async function DELETE(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json(
        { ok: false, error: "Missing id parameter." },
        { status: 400 }
      );
    }
    const p = draftPath(id);
    if (existsSync(p)) {
      unlinkSync(p);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 }
    );
  }
}
