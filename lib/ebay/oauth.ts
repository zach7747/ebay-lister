// eBay OAuth: authorize URL, code exchange, and token refresh.
// Ported from _get_oauth_code / _exchange_code / _refresh_token in the script.

import {
  EBAY_OAUTH_URL,
  EBAY_TOKEN_URL,
  EBAY_SCOPES,
  basicAuthHeader,
  getEbayCreds,
  type EbayCreds,
} from "./config";

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  token_type: string;
}

// Step 1: the URL we send the user to so they can authorize the app.
// `redirect_uri` is the RuName (per eBay's flow); the RuName's configured
// "auth accepted URL" is what the browser actually returns to.
export function buildAuthorizeUrl(state: string): string {
  const creds = getEbayCreds();
  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: creds.ruName,
    response_type: "code",
    scope: EBAY_SCOPES,
    state,
  });
  return `${EBAY_OAUTH_URL}?${params.toString()}`;
}

async function postToken(
  creds: EbayCreds,
  body: Record<string, string>
): Promise<TokenResponse> {
  const resp = await fetch(EBAY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(creds),
    },
    body: new URLSearchParams(body).toString(),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`eBay token request failed (${resp.status}): ${text.slice(0, 300)}`);
  }
  return (await resp.json()) as TokenResponse;
}

// Step 2: exchange the authorization code for access + refresh tokens.
export function exchangeCode(code: string): Promise<TokenResponse> {
  const creds = getEbayCreds();
  return postToken(creds, {
    grant_type: "authorization_code",
    code,
    redirect_uri: creds.ruName,
  });
}

// Mint a fresh short-lived access token from a stored refresh token.
export function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const creds = getEbayCreds();
  return postToken(creds, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    // Don't send scope — eBay uses the scopes from the original authorization.
    // Sending new/extra scopes here causes "invalid_scope" errors.
  });
}
