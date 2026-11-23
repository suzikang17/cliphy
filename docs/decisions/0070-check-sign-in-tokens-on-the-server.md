---
type: decision
title: "Sign-in tokens are checked on the server against the project's public keys"
date: 2026-11-23
category: Server
revisit: true
---

## Why this choice

Every signed-in request began with `supabase.auth.getUser(token)`: a network call to Supabase to ask whether the token is good, before any work. The project publishes an ES256 signing key (`/auth/v1/.well-known/jwks.json`), so the server can check the signature itself.

`authMiddleware` now calls `supabase.auth.getClaims(token)` (supabase-js's own method). It verifies the signature and expiry locally with WebCrypto, fetching the public keys once per server instance and keeping them ten minutes. A token signed the older way (HS256, a shared secret) is still checked by `getUser`, inside `getClaims`, so nothing breaks if the project is still issuing those.

- A token with no `sub` is refused: the project's own anon and service keys are tokens too.
- `getClaims` throws for an expired token rather than answering with an error. The middleware turns any throw into a 401, which is what makes the apps renew their sign-in. A test with real signatures caught this.

## Options considered

- **Keep asking Supabase.** Always current; one more round trip on every request.
- **Verify with `jose` and our own key cache.** The same result with more code to own.
- **Cache `getUser` answers in memory.** A serverless instance is short-lived and each one starts empty.

## Tradeoffs

- A signed-out session, or a deleted or banned account, keeps working until its token expires (an hour at most by default). API keys are unaffected: they are looked up on every request.
- Whether live tokens are ES256 yet was not confirmed from here (it needs a real token). If the project still signs with HS256, this change is harmless and gains nothing until the key is switched in Supabase → Settings → JWT Keys.
