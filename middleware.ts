import { NextRequest, NextResponse } from "next/server";

/**
 * HTTP Basic Auth middleware.
 * Set APP_USER and APP_PASS in .env.local.
 * Skips static assets and internal Next.js routes.
 */
export function middleware(req: NextRequest) {
  const user = process.env.APP_USER;
  const pass = process.env.APP_PASS;
  if (!user || !pass) return NextResponse.next(); // no creds configured = open

  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    const decoded = atob(auth.slice(6));
    const [u, p] = decoded.split(":", 2);
    if (u === user && p === pass) return NextResponse.next();
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="eBay Lister"' },
  });
}

export const config = {
  // Match all paths except static files and Next internals
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
