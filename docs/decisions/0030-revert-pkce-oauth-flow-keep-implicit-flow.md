---
date: 2026-03-02
title: "Revert PKCE OAuth flow, keep implicit flow"
category: Tech
revisit: true
---

# Revert PKCE OAuth flow, keep implicit flow

**Date:** 2026-03-02 · **Category:** Tech · **Revisit?** yes

## Why this choice

launchWebAuthFlow can't load Supabase authorize page with PKCE params — page fails to render. Implicit flow works reliably. PKCE is not required for Chrome Web Store review.

## Options considered

1. PKCE flow via launchWebAuthFlow
2. Implicit flow (current, working)

## Tradeoffs

Implicit flow is less secure (token in URL fragment) but works. PKCE would be better security but is currently broken with the Chrome extension + Supabase combo.
