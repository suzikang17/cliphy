---
date: 2026-06-07
title: "Rotating Decodo proxy port over sticky session ports"
category: Infra
revisit: false
---

# Rotating Decodo proxy port over sticky session ports

**Date:** 2026-06-07 · **Category:** Infra · **Revisit?** no

## Why this choice

The summarize worker fetches transcripts through Decodo residential proxies (YouTube blocks datacenter IPs). `PROXY_URL` was pointed at a **sticky-session port** (`gate.decodo.com:10001`), which pins all traffic to one residential IP for ~10 min. Under burst load (Inngest fan-out + retries) every concurrent fetch hammered that single IP, tripping YouTube's per-IP rate limit (~100 req/min/IP) and producing `ConnectTimeoutError` to `www.youtube.com:443`. Switching to the **rotating port `:7000`** gives a fresh IP per request, spreading load across Decodo's pool.

Verified from Vercel: a 5×8 (~40 concurrent) burst that failed **40/40** on the sticky port passed **40/40** on the rotating port.

## Options considered

- **Rotating port `:7000`** (chosen) — new IP per request.
- **Sticky ports (`:10001`–`:10010`)** — stable IP per session; what we had. Wrong for a high-concurrency fan-out.
- **Multiple sticky ports round-robined** — doesn't raise the ceiling; residential concurrency is unlimited and the limit is YouTube per-IP, so rotation (one port, many IPs) is strictly better.
- **Whitelist Vercel IP on Decodo** — rejected; auth method, not a perf lever, and Vercel has no stable egress IP.

## Tradeoffs

- Rotating means no session stickiness (irrelevant here — each transcript fetch is independent).
- A single rotated IP can still hit a transient YouTube `429`; absorbed by Inngest retries.
- Real budget ceilings now are **Anthropic ITPM** (see ADR 0038-adjacent concurrency sizing) and the **3GB Decodo bandwidth** plan — not concurrency.
