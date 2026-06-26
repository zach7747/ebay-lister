import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { guardApiRequest } from "@/lib/api-guard";

const DIR = join(process.env.HOME || "/root", "ebay-lister-drafts");
const FILE = join(DIR, "instructions.txt");

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  try {
    const body = await req.json();
    mkdirSync(DIR, { recursive: true });
    writeFileSync(FILE, String(body?.text ?? ""), "utf-8");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const denied = guardApiRequest(req);
  if (denied) return denied;

  try {
    const text = existsSync(FILE) ? readFileSync(FILE, "utf-8") : "";
    return NextResponse.json({ ok: true, text });
  } catch {
    return NextResponse.json({ ok: true, text: "" });
  }
}
