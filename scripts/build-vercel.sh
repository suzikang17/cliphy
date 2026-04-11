#!/bin/bash
set -e

# ── 1. Build the web app (static SPA) ──
pnpm --filter web build

# ── 2. Bundle the API server into a Vercel Function ──
pnpm exec esbuild apps/server/src/vercel.ts \
  --bundle \
  --platform=node \
  --format=cjs \
  --jsx=automatic \
  --jsx-import-source=hono/jsx \
  --outfile=.vercel/output/functions/api/index.func/index.js

# Function config
cat > .vercel/output/functions/api/index.func/.vc-config.json << 'EOF'
{
  "runtime": "nodejs20.x",
  "handler": "index.js",
  "launcherType": "Nodejs",
  "maxDuration": 60
}
EOF

# Copy htmx.js next to the bundle (no node_modules at runtime in Vercel serverless)
cp apps/server/node_modules/htmx.org/dist/htmx.min.js .vercel/output/functions/api/index.func/htmx.min.js

# ── 3. Static files ──
# Web app SPA output → static root
cp -r apps/web/dist/* .vercel/output/static/

# Server static pages (terms, privacy, logo)
mkdir -p .vercel/output/static/terms .vercel/output/static/privacy
cp apps/server/src/pages/terms.html .vercel/output/static/terms/index.html
cp apps/server/src/pages/privacy.html .vercel/output/static/privacy/index.html
cp apps/server/src/pages/logo.svg .vercel/output/static/logo.svg

# ── 4. Middleware for OG meta tags ──
if [ -f apps/web/middleware.ts ]; then
  pnpm exec esbuild apps/web/middleware.ts \
    --bundle \
    --platform=neutral \
    --format=esm \
    --outfile=.vercel/output/functions/_middleware.func/index.js

  cat > .vercel/output/functions/_middleware.func/.vc-config.json << 'EOF'
{
  "runtime": "edge",
  "entrypoint": "index.js"
}
EOF

  cat > .vercel/output/functions/_middleware.func/package.json << 'EOF'
{ "type": "module" }
EOF
fi

# ── 5. Output config ──
cat > .vercel/output/config.json << 'EOF'
{
  "version": 3,
  "routes": [
    { "src": "/api/(.*)", "dest": "/api" },
    { "handle": "filesystem" },
    { "src": "/(.*)", "dest": "/index.html" }
  ]
}
EOF
