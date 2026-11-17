#!/bin/bash
set -e

# ── 0. Apply pending DB migrations ──
# Runs before the build so schema changes always land before the code that
# depends on them. If this fails, the build fails and the previous (working)
# deployment keeps serving traffic — nothing half-deploys.
pnpm --filter server migrate:deploy

# ── 1. Build the web app (static SPA) ──
pnpm --filter web build

# ── 1b. Build the coach's screens (the phone app, built for the web) ──
# Served beside the web app at /chat, /projects and /coach/*, signed in by the
# web app's own sign-in (same site, same stored session). See ADR 0066.
# A failure here must not stop the API from deploying: the site then ships
# without those pages, and the log says so.
COACH_WEB=.vercel/coach-web
rm -rf "$COACH_WEB"
if (cd apps/mobile && \
    EXPO_PUBLIC_API_URL="" \
    EXPO_PUBLIC_SUPABASE_URL="${VITE_SUPABASE_URL:-}" \
    EXPO_PUBLIC_SUPABASE_ANON_KEY="${VITE_SUPABASE_ANON_KEY:-}" \
    CI=1 npx expo export --platform web --clear --output-dir "../../$COACH_WEB"); then
  echo "Coach screens built."
else
  echo "WARNING: the coach's web screens did not build; deploying without them."
  rm -rf "$COACH_WEB"
fi

# ── 2. Bundle the API server into a Vercel Function ──
pnpm exec esbuild apps/server/src/vercel.ts \
  --bundle \
  --platform=node \
  --format=cjs \
  --jsx=automatic \
  --jsx-import-source=hono/jsx \
  --external:sharp \
  --outfile=.vercel/output/functions/api/index.func/index.js

# Function config
cat > .vercel/output/functions/api/index.func/.vc-config.json << 'EOF'
{
  "runtime": "nodejs22.x",
  "handler": "index.js",
  "launcherType": "Nodejs",
  "maxDuration": 60
}
EOF

# Copy htmx.js next to the bundle (no node_modules at runtime in Vercel serverless)
HTMX_PATH=$(node -e "console.log(require.resolve('htmx.org/dist/htmx.min.js'))")
cp "$HTMX_PATH" .vercel/output/functions/api/index.func/htmx.min.js

# ── 3. Static files ──
# Web app SPA output → static root
mkdir -p .vercel/output/static
cp -r apps/web/dist/* .vercel/output/static/

# Coach screens: their files sit beside the web app's (no names in common),
# and their page is served for the coach's addresses by the routes below.
if [ -f "$COACH_WEB/index.html" ]; then
  cp -r "$COACH_WEB/_expo" .vercel/output/static/_expo
  mkdir -p .vercel/output/static/assets
  cp -r "$COACH_WEB/assets/." .vercel/output/static/assets/
  cp "$COACH_WEB/index.html" .vercel/output/static/coach-app.html
fi

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
    { "src": "/admin/(.*)", "dest": "/api" },
    { "handle": "filesystem" },
    { "src": "/(chat|projects)", "dest": "/coach-app.html" },
    { "src": "/coach/(.*)", "dest": "/coach-app.html" },
    { "src": "/(.*)", "dest": "/index.html" }
  ]
}
EOF
