import type { NextConfig } from "next";

const API = process.env["DFL_API_URL"] ?? "http://localhost:4000";
const dev = process.env.NODE_ENV === "development";

// Production: a static export served by the Defluance server itself (one process, one port).
// Development: the Next dev server proxies the API so cookies stay same-origin.
const config: NextConfig = {
  ...(dev
    ? {
        async rewrites() {
          return ["/api/:path*", "/auth/:path*", "/health", "/metrics", "/mcp"].map((source) => ({ source, destination: `${API}${source}` }));
        },
      }
    : { output: "export" as const }),
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default config;
