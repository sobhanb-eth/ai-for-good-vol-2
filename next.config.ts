import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The game client is a self-contained static app (public/game.html + shim.js).
  // Serve it at the root; route handlers under /api keep the keys server-side.
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/", destination: "/game.html" },
        { source: "/teacher", destination: "/game.html" },
        { source: "/add-post", destination: "/game.html" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
