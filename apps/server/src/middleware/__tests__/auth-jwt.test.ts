import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../../env.js";

// A sign-in token checked on the server itself: a real Supabase client, real
// ES256 signatures, and a stand-in for Supabase's network that counts what it
// is asked. The point is what is NOT asked: no /user call per request.

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const stranger = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
const KID = "key-1";

const asked: string[] = [];
let userAnswer: { status: number; body: unknown };

const network = async (input: RequestInfo | URL): Promise<Response> => {
  const url = String(input instanceof Request ? input.url : input);
  asked.push(new URL(url).pathname);
  if (url.endsWith("/auth/v1/.well-known/jwks.json")) {
    const jwk = publicKey.export({ format: "jwk" });
    return Response.json({ keys: [{ ...jwk, kid: KID, alg: "ES256", use: "sig" }] });
  }
  if (url.endsWith("/auth/v1/user")) {
    return Response.json(userAnswer.body, { status: userAnswer.status });
  }
  return Response.json({}, { status: 404 });
};

vi.mock("../../lib/supabase.js", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return {
    supabase: createClient("http://supabase.test", "service-key", {
      global: { fetch: network as typeof fetch },
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
});

const { authMiddleware } = await import("../auth.js");

const b64 = (value: object | Buffer) =>
  (Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value))).toString("base64url");

/** A token as Supabase issues them. */
function token(
  claims: Record<string, unknown>,
  opts: { key?: KeyObject; alg?: string; kid?: string | null } = {},
): string {
  const alg = opts.alg ?? "ES256";
  const header = { alg, typ: "JWT", ...(opts.kid === null ? {} : { kid: opts.kid ?? KID }) };
  const body = `${b64(header)}.${b64({ exp: Math.floor(Date.now() / 1000) + 3600, ...claims })}`;
  const signature =
    alg === "ES256"
      ? sign("sha256", Buffer.from(body), {
          key: opts.key ?? privateKey,
          dsaEncoding: "ieee-p1363",
        })
      : Buffer.from("shared-secret-signature");
  return `${body}.${b64(signature)}`;
}

const whoami = (bearer: string) => {
  const app = new Hono<AppEnv>();
  app.use("*", authMiddleware);
  app.get("/whoami", (c) =>
    c.json({ userId: c.get("userId"), email: c.get("userEmail"), method: c.get("authMethod") }),
  );
  return app.request("/whoami", { headers: { Authorization: `Bearer ${bearer}` } });
};

const PERSON = { sub: "user-1", email: "a@b.c", role: "authenticated" };

beforeEach(() => {
  asked.length = 0;
  userAnswer = { status: 401, body: { msg: "invalid" } };
});

describe("a sign-in token signed with the project's key", () => {
  it("is accepted without asking Supabase who it belongs to", async () => {
    const res = await whoami(token(PERSON));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "user-1", email: "a@b.c", method: "jwt" });
    expect(asked).not.toContain("/auth/v1/user");
  });

  it("fetches the public keys once, then checks later requests with no network at all", async () => {
    await whoami(token(PERSON)); // the keys may be fetched here
    asked.length = 0;
    for (let i = 0; i < 3; i++) expect((await whoami(token(PERSON))).status).toBe(200);
    // (The "last active" note still goes to the database, without being waited on.)
    expect(asked.filter((path) => path.startsWith("/auth/"))).toEqual([]);
  });

  it("is refused once it has expired", async () => {
    const res = await whoami(token({ ...PERSON, exp: Math.floor(Date.now() / 1000) - 60 }));
    expect(res.status).toBe(401);
  });

  it("is refused when signed by anyone else", async () => {
    expect((await whoami(token(PERSON, { key: stranger }))).status).toBe(401);
  });

  it("is refused when its contents were changed after signing", async () => {
    const [header, , signature] = token(PERSON).split(".");
    const forged = `${header}.${b64({ ...PERSON, sub: "someone-else", exp: 9999999999 })}.${signature}`;
    expect((await whoami(forged)).status).toBe(401);
  });

  it("is refused when it names no person, as the project's own keys do not", async () => {
    expect((await whoami(token({ role: "anon" }))).status).toBe(401);
  });
});

describe("a token signed the older way, with a shared secret", () => {
  it("is still checked by asking Supabase, and accepted when Supabase knows it", async () => {
    userAnswer = { status: 200, body: { id: "user-1", email: "a@b.c", aud: "authenticated" } };
    const res = await whoami(token(PERSON, { alg: "HS256", kid: null }));
    expect(res.status).toBe(200);
    expect(asked).toContain("/auth/v1/user");
  });

  it("is refused when Supabase does not know it", async () => {
    expect((await whoami(token(PERSON, { alg: "HS256", kid: null }))).status).toBe(401);
  });
});

it("refuses something that is not a token at all", async () => {
  expect((await whoami("not-a-token")).status).toBe(401);
});
