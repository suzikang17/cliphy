# Landing Page + Static Pages Migration

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a landing page for Stripe compliance and migrate terms/privacy from Hono routes to static HTML files.

**Architecture:** All public-facing HTML pages become static files served from `.vercel/output/static/`. The Hono app stays purely API. The build script copies HTML files into the static output directory.

**Tech Stack:** HTML, CSS (Inter font, same style as existing pages), Vercel Build Output API static serving.

---

### Task 1: Create the pages directory and extract terms.html

**Files:**

- Create: `apps/server/src/pages/terms.html`
- Reference: `apps/server/src/routes/terms.ts`

**Step 1: Create `apps/server/src/pages/` directory and `terms.html`**

Copy the HTML from `apps/server/src/routes/terms.ts` into a standalone HTML file. The template literal uses `${LAST_UPDATED}` — inline the value "March 6, 2026" directly.

**Step 2: Verify the HTML is valid**

Open `apps/server/src/pages/terms.html` in a browser to confirm it renders correctly.

---

### Task 2: Extract privacy.html

**Files:**

- Create: `apps/server/src/pages/privacy.html`
- Reference: `apps/server/src/routes/privacy.ts`

**Step 1: Create `privacy.html`**

Same process as terms — copy HTML from `apps/server/src/routes/privacy.ts`, inline `${LAST_UPDATED}` as "February 28, 2026".

**Step 2: Verify the HTML renders correctly**

---

### Task 3: Create landing.html

**Files:**

- Create: `apps/server/src/pages/landing.html`

**Step 1: Create the landing page**

Same Inter font + base styles as terms/privacy. Content sections:

1. **Hero** — "Cliphy" heading, tagline "AI-powered YouTube video summaries", "Install from Chrome Web Store" button linking to `#` (placeholder URL to replace later)
2. **How it works** — 3 steps: "Add a video" / "AI summarizes it" / "Read your summary"
3. **Pricing** — Free (5 summaries/month, 7-day history) vs Pro (100 summaries/month, unlimited history, batch queue, deep dive, custom prompts, export)
4. **Refund & Cancellation** — "Cancel anytime from the extension. Cancellation takes effect at the end of your current billing period. No refunds for partial billing periods. If you believe you were charged in error, contact us."
5. **Footer** — Links to /terms, /privacy, contact email (cliphy.ai+support@gmail.com), copyright

Style notes:

- Wider max-width than terms/privacy (960px vs 680px) since it's a marketing page
- Centered hero section
- Pricing as two side-by-side cards (flexbox, stack on mobile)
- Keep it minimal — no images, no JS

**Step 2: Verify it renders correctly in a browser**

---

### Task 4: Remove Hono routes and clean up imports

**Files:**

- Delete: `apps/server/src/routes/terms.ts`
- Delete: `apps/server/src/routes/privacy.ts`
- Modify: `apps/server/src/app.ts` — remove terms/privacy imports and route registrations (lines 17-18, 59-60)
- Modify: `apps/server/src/vercel.ts` — remove terms/privacy imports and root-level routes (lines 8-9, 13-14)

**Step 1: Update `app.ts`**

Remove:

```ts
import { privacyRoutes } from "./routes/privacy.js";
import { termsRoutes } from "./routes/terms.js";
```

and:

```ts
app.route("/privacy", privacyRoutes);
app.route("/terms", termsRoutes);
```

**Step 2: Update `vercel.ts`**

Remove:

```ts
import { privacyRoutes } from "./routes/privacy.js";
import { termsRoutes } from "./routes/terms.js";
```

and:

```ts
root.route("/privacy", privacyRoutes);
root.route("/terms", termsRoutes);
```

Since the root Hono app (`root`) now only routes `/` to `app`, simplify `vercel.ts` to just export the app directly:

```ts
import { initSentry } from "./lib/sentry.js";
initSentry();

import "./lib/env.js";
import { getRequestListener } from "@hono/node-server";
import app from "./app.js";

export default getRequestListener(app.fetch);
```

Wait — `app` uses `.basePath("/api")`, so all its routes are under `/api`. The root Hono wrapper was needed to mount things outside `/api`. Since static files now handle `/`, `/terms`, `/privacy`, and the only server routes are `/api/*`, we can just export `app` directly.

**Step 3: Delete the route files**

```bash
rm apps/server/src/routes/terms.ts apps/server/src/routes/privacy.ts
```

**Step 4: Verify the server still builds**

```bash
pnpm --filter server build
```

---

### Task 5: Update build script for static files

**Files:**

- Modify: `scripts/build-vercel.sh`

**Step 1: Update `build-vercel.sh`**

Replace the current script with:

```bash
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

# Output config — only API rewrite needed now
cat > .vercel/output/config.json << 'EOF'
{
  "version": 3,
  "routes": [
    { "src": "/api/(.*)", "dest": "/api" }
  ]
}
EOF

# Static pages
mkdir -p .vercel/output/static/terms .vercel/output/static/privacy
cp apps/server/src/pages/landing.html .vercel/output/static/index.html
cp apps/server/src/pages/terms.html .vercel/output/static/terms/index.html
cp apps/server/src/pages/privacy.html .vercel/output/static/privacy/index.html
```

Key changes:

- Removed `/privacy` and `/terms` rewrites from routes (no longer needed — served as static files)
- Copy landing.html as `static/index.html` (serves at `/`)
- Copy terms/privacy as `static/<name>/index.html` (serves at `/terms` and `/privacy` with clean URLs)

**Step 2: Test the build**

```bash
bash scripts/build-vercel.sh
```

Verify the output:

```bash
ls -la .vercel/output/static/
ls -la .vercel/output/static/terms/
ls -la .vercel/output/static/privacy/
```

---

### Task 6: Commit

```bash
git add apps/server/src/pages/ scripts/build-vercel.sh apps/server/src/app.ts apps/server/src/vercel.ts
git rm apps/server/src/routes/terms.ts apps/server/src/routes/privacy.ts
git commit -m "add landing page, migrate terms/privacy to static files"
```
