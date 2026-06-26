import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const projectRoot = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root to this project (a stray lockfile elsewhere on the
  // machine would otherwise confuse Next's root detection).
  outputFileTracingRoot: projectRoot,
  // The analyze API receives base64 photos in the request body.
  // Photos are resized in the browser first, but allow generous headroom.
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
  async headers() {
    return [
      {
        // Force browsers to revalidate Next.js chunks on every visit so
        // deploys are picked up immediately without a hard-refresh.
        source: "/_next/static/(.*)",
        headers: [
          { key: "Cache-Control", value: "no-cache, must-revalidate" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          // Keep this private deployment out of search results. Remove if you
          // ever want the live instance publicly discoverable.
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // Next.js inlines runtime scripts/styles; tighten to nonces if needed.
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              // blob:/data: for in-browser photo resizing previews
              "img-src 'self' data: blob: https://i.ebayimg.com",
              "connect-src 'self'",
              "frame-src 'none'",
              "object-src 'none'",
              "base-uri 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
