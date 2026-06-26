import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { guardApiRequest } from "@/lib/api-guard";

const DRAFT_DIR = join(process.env.HOME || "/root", "ebay-lister-drafts");
const DRAFT_FILE = join(DRAFT_DIR, "current.json");

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  try {
    const body = await req.json();
    mkdirSync(DRAFT_DIR, { recursive: true });
    writeFileSync(DRAFT_FILE, JSON.stringify(body), "utf-8");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  try {
    if (!existsSync(DRAFT_FILE)) {
      return NextResponse.json({ ok: true, draft: null });
    }
    const data = JSON.parse(readFileSync(DRAFT_FILE, "utf-8"));
    return NextResponse.json({ ok: true, draft: data });
  } catch {
    return NextResponse.json({ ok: true, draft: null });
  }
}
