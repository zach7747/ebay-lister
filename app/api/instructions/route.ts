import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { guardApiRequest } from "@/lib/api-guard";
import { DEFAULT_LISTING_INSTRUCTIONS } from "@/lib/default-instructions";

const DIR = join(process.env.HOME || "/root", "ebay-lister-drafts");
const FILE = join(DIR, "instructions.txt");
// Vercel's serverless FS is not persistent — resolve the write path there to /tmp.
const WRITE_FILE = process.env.VERCEL ? "/tmp/ebay-lister-instructions.txt" : FILE;

export const dynamic = "force-dynamic";

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

  // Never clobber the baked-in default with an empty string.
  if (!text.trim()) {
    return NextResponse.json({ ok: true, persisted: false });
  }

  try {
    mkdirSync(dirname(WRITE_FILE), { recursive: true });
    writeFileSync(WRITE_FILE, text, "utf-8");
    return NextResponse.json({ ok: true, persisted: true });
  } catch {
    // Write failure must never 500 the UI — edits just won't persist.
    return NextResponse.json({ ok: true, persisted: false });
  }
}

export async function GET(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  try {
    const text = existsSync(WRITE_FILE) ? readFileSync(WRITE_FILE, "utf-8") : "";
    const result = text && text.trim() ? text : DEFAULT_LISTING_INSTRUCTIONS;
    return NextResponse.json({ ok: true, text: result });
  } catch {
    return NextResponse.json({ ok: true, text: DEFAULT_LISTING_INSTRUCTIONS });
  }
}
