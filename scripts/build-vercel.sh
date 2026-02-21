#!/bin/bash
set -e

# Bundle the server into a single file
pnpm exec esbuild apps/server/src/vercel.ts \
  --bundle \
  --platform=node \
  --format=cjs \
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

# Output config with rewrites
cat > .vercel/output/config.json << 'EOF'
{
  "version": 3,
  "routes": [
    { "src": "/api/(.*)", "dest": "/api" }
  ]
}
EOF

# Empty static dir (required)
mkdir -p .vercel/output/static
