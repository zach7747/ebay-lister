import { NextRequest, NextResponse } from "next/server";
import { EBAY_COOKIE, accessTokenFromCookie } from "@/lib/ebay/session";
import { guardApiRequest } from "@/lib/api-guard";
import { fetchAccountSetup, publishListing } from "@/lib/ebay/publish";
import { logError, logInfo } from "@/lib/logger";
import type { PublishInput } from "@/lib/ebay/publish";

// Photo upload + several eBay calls + recovery loops — give it room.
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  // Check access + rate limit BEFORE parsing the (potentially large) body.
  const denied = guardApiRequest(req);
  if (denied) return denied;

  let body: PublishInput;
  try {
    body = (await req.json()) as PublishInput;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request." }, { status: 400 });
  }

  // Field-by-field validation: the old combined message ("Missing SKU,
// listing, or photos.") hid the real cause — typically empty images when a
// restored session had no photo blobs on the current device.
  if (!body.sku) {
    return NextResponse.json(
      { success: false, error: "Missing SKU — this item has no bin code yet. Edit the SKU and post again." },
      { status: 400 }
    );
  }
  if (!body.listing) {
    return NextResponse.json(
      { success: false, error: "Missing listing data — the listing hasn't been written yet. Generate it, then post." },
      { status: 400 }
    );
  }
  if (!Array.isArray(body.images) || body.images.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error:
          "No photos reached the server. The draft's photo bytes aren't on this device — re-upload them here, or post from the device where you took the photos.",
      },
      { status: 400 }
    );
  }

  // Mint a fresh access token from the encrypted connection cookie.
  let accessToken: string | null;
  try {
    accessToken = await accessTokenFromCookie(req.cookies.get(EBAY_COOKIE)?.value);
  } catch (e) {
    logError("/api/ebay/publish", "Token minting failed", e);
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
  if (!accessToken) {
    return NextResponse.json(
      { success: false, error: "eBay isn't connected. Connect your account and try again." },
      { status: 401 }
    );
  }

  logInfo("/api/ebay/publish", `Publishing SKU ${body.sku} (${body.images.length} images)`);

  try {
    const setup = await fetchAccountSetup(accessToken);
    const result = await publishListing(accessToken, setup, body);
    if (result.success) {
      logInfo("/api/ebay/publish", `Published SKU ${body.sku} → listing ${result.listingId}`);
    } else {
      logError("/api/ebay/publish", `Publish failed for SKU ${body.sku}: ${result.error}`);
    }
    // A structured eBay validation rejection is a client-facing listing error,
    // not a bad-gateway response. Some proxies replace 502 bodies with HTML,
    // which made the UI incorrectly report these as request timeouts.
    return NextResponse.json(result, { status: result.success ? 200 : 422 });
  } catch (e) {
    logError("/api/ebay/publish", `Publish error for SKU ${body.sku}`, e);
    return NextResponse.json(
      { success: false, sku: body.sku, error: (e as Error).message },
      { status: 500 }
    );
  }
}
