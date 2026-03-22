#!/bin/bash
set -e

# Bundle the server into a single file
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

# Output config — only API rewrite needed
cat > .vercel/output/config.json << 'EOF'
{
  "version": 3,
  "routes": [
    { "src": "/api/(.*)", "dest": "/api" }
  ]
}
EOF

# Copy htmx.js next to the bundle (no node_modules at runtime in Vercel serverless)
cp apps/server/node_modules/htmx.org/dist/htmx.min.js .vercel/output/functions/api/index.func/htmx.min.js

# Static pages
mkdir -p .vercel/output/static/terms .vercel/output/static/privacy
cp apps/server/src/pages/landing.html .vercel/output/static/index.html
cp apps/server/src/pages/terms.html .vercel/output/static/terms/index.html
cp apps/server/src/pages/privacy.html .vercel/output/static/privacy/index.html
cp logo-concepts/final-logo.svg .vercel/output/static/logo.svg
