import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The game client is a self-contained static app (public/index.html + shim.js); route
  // handlers under /api keep the keys server-side. On Cloudflare Workers the asset layer
  // serves public/index.html at "/" before the app runs; this rewrite does the same for
  // `next dev` / `next start`, which don't serve public/index.html at "/" on their own.
  async rewrites() {
    return {
      beforeFiles: [{ source: "/", destination: "/index.html" }],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
