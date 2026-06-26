// eBay Marketplace Account Deletion notification endpoint.
// eBay requires this for GDPR/privacy compliance.
//
// Verification flow: eBay sends a GET with ?challengeCode=XXX.
// We respond with SHA256(VERIFICATION_TOKEN + challengeCode + endpointURL).
// Set EBAY_VERIFICATION_TOKEN in .env.local to match what you enter in the
// eBay developer portal.

import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const challengeCode = req.nextUrl.searchParams.get("challengeCode");
  const token = process.env.EBAY_VERIFICATION_TOKEN;

  if (challengeCode && token) {
    const endpoint = `${process.env.APP_URL}/api/ebay/account-deletion`;
    const hash = createHash("sha256")
      .update(token + challengeCode + endpoint)
      .digest("hex");
    return NextResponse.json({ verificationCode: hash });
  }

  if (challengeCode) {
    // Fallback: no token configured, just echo the challenge code
    return NextResponse.json({ challengeCode });
  }

  return NextResponse.json({
    status: "ok",
    message: "eBay account deletion notification endpoint is active.",
  });
}

// eBay POSTs actual deletion notifications here.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log("[eBay] Account deletion notification received:", body);
  } catch {
    // ignore parse errors
  }
  return NextResponse.json({ status: "received" });
}
