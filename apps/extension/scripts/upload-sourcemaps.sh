#!/bin/bash
# Upload source maps to Sentry after extension build
# Requires SENTRY_AUTH_TOKEN and SENTRY_ORG env vars

if [ -z "$SENTRY_AUTH_TOKEN" ]; then
  echo "Skipping source map upload (SENTRY_AUTH_TOKEN not set)"
  exit 0
fi

npx @sentry/cli sourcemaps inject .output/chrome-mv3
npx @sentry/cli sourcemaps upload .output/chrome-mv3 \
  --org "$SENTRY_ORG" \
  --project cliphy-extension
