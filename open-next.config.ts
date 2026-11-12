import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Default config: the game is static and the API routes are dynamic, so no incremental
// cache (R2/KV) is needed.
export default defineCloudflareConfig({});
