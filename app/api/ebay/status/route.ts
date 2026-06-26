import { NextRequest, NextResponse } from "next/server";
import { rateLimitRequest } from "@/lib/api-guard";
import { isEbayConfigured } from "@/lib/ebay/config";
import { EBAY_COOKIE, isConnected } from "@/lib/ebay/session";

export const dynamic = "force-dynamic";

// Lightweight check the UI calls on load: is eBay set up + connected?
// Checks server-side file first, then cookie as fallback.
export async function GET(req: NextRequest) {
  const limited = rateLimitRequest(req);
  if (limited) return limited;

  const configured = isEbayConfigured();
  const connected = await isConnected(req.cookies.get(EBAY_COOKIE)?.value);
  return NextResponse.json({ configured, connected });
}
