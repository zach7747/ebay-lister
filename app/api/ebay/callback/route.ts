import { NextRequest, NextResponse } from "next/server";
import { rateLimitRequest } from "@/lib/api-guard";
import { exchangeCode } from "@/lib/ebay/oauth";
import {
  EBAY_COOKIE,
  EBAY_COOKIE_MAX_AGE,
  EBAY_STATE_COOKIE,
  connectionFromToken,
  saveConnection,
} from "@/lib/ebay/session";
import { logError, logInfo } from "@/lib/logger";

export const dynamic = "force-dynamic";

function appUrl(req: NextRequest, path: string): URL {
  const base = process.env.APP_URL || req.nextUrl.origin;
  return new URL(path, base);
}

// eBay redirects the user back here with ?code=... after they consent.
export async function GET(req: NextRequest) {
  const limited = rateLimitRequest(req);
  if (limited) return limited;

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const expectedState = req.cookies.get(EBAY_STATE_COOKIE)?.value;

  if (!code) {
    logError("/api/ebay/callback", "No authorization code in redirect");
    return NextResponse.redirect(appUrl(req, "/?ebay=error&msg=No+authorization+code"));
  }
  if (!state || !expectedState || state !== expectedState) {
    logError("/api/ebay/callback", "State mismatch", undefined, {
      received: state,
      expected: expectedState,
    });
    return NextResponse.redirect(appUrl(req, "/?ebay=error&msg=State+mismatch"));
  }

  try {
    const token = await exchangeCode(code);
    if (!token.refresh_token) {
      throw new Error("eBay did not return a refresh token.");
    }
    const sealed = await saveConnection(
      connectionFromToken(token.refresh_token, token.refresh_token_expires_in)
    );
    logInfo("/api/ebay/callback", "eBay OAuth successful, token saved to server");
    const res = NextResponse.redirect(appUrl(req, "/?ebay=connected"));
    // Also set cookie as a fallback for backwards compat.
    res.cookies.set(EBAY_COOKIE, sealed, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: EBAY_COOKIE_MAX_AGE,
    });
    res.cookies.delete(EBAY_STATE_COOKIE);
    return res;
  } catch (e) {
    logError("/api/ebay/callback", "OAuth code exchange failed", e);
    const msg = encodeURIComponent((e as Error).message);
    return NextResponse.redirect(appUrl(req, `/?ebay=error&msg=${msg}`));
  }
}
