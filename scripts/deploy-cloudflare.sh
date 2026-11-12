#!/usr/bin/env bash
# Build and deploy to Cloudflare Workers WITHOUT bundling local .env files.
#
# OpenNext copies the values of .env, .env.local, .env.production(.local), ... into
# .open-next/cloudflare/next-env.mjs, which is bundled into the uploaded Worker. API keys
# must live in Worker secrets instead (npx wrangler secret put OPENAI_API_KEY, ...), so the
# local env files are moved aside for the build and always restored afterwards.
set -euo pipefail
cd "$(dirname "$0")/.."

stash="$(mktemp -d)"
restore() {
  for f in "$stash"/.env*; do [ -e "$f" ] && mv "$f" .; done
  rmdir "$stash" 2>/dev/null || true
}
trap restore EXIT

for f in .env .env.local .env.production .env.production.local .env.development .env.development.local .env.test .env.test.local; do
  if [ -f "$f" ]; then mv "$f" "$stash/"; fi
done

npx opennextjs-cloudflare build

# Last line of defence: never upload a bundle that carries API keys.
if grep -q '_KEY"' .open-next/cloudflare/next-env.mjs; then
  echo "Refusing to deploy: env file values were bundled into the Worker." >&2
  exit 1
fi

if [ "${DRY_RUN:-}" = "1" ]; then
  # Validate the bundle and print its size without uploading anything.
  npx wrangler deploy --dry-run
else
  npx opennextjs-cloudflare deploy -- --keep-vars
fi
