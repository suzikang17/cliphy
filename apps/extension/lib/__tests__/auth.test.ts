import { describe, it, expect, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import { isTokenExpired, getUserIdFromToken } from "../auth.js";

/** Create a minimal JWT with given payload. NOT cryptographically valid — just for parsing tests. */
function fakeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.fake-signature`;
}

describe("isTokenExpired", () => {
  beforeEach(() => {
    layer("unit");
    epic("Auth");
    feature("Token Expiry");
  });
  it("returns true for expired token", () => {
    const token = fakeJwt({ exp: Math.floor(Date.now() / 1000) - 60 }); // 60s ago
    expect(isTokenExpired(token)).toBe(true);
  });

  it("returns false for valid token with plenty of time left", () => {
    const token = fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }); // 1 hour from now
    expect(isTokenExpired(token)).toBe(false);
  });

  it("returns true when token expires within buffer", () => {
    const token = fakeJwt({ exp: Math.floor(Date.now() / 1000) + 10 }); // 10s from now
    expect(isTokenExpired(token, 30)).toBe(true); // 30s buffer
  });

  it("returns true for token without exp claim", () => {
    const token = fakeJwt({ sub: "user-123" });
    expect(isTokenExpired(token)).toBe(true);
  });

  it("returns true for malformed token", () => {
    expect(isTokenExpired("not.a.jwt")).toBe(true);
    expect(isTokenExpired("")).toBe(true);
  });
});

describe("getUserIdFromToken", () => {
  beforeEach(() => {
    layer("unit");
    epic("Auth");
    feature("Token Parsing");
  });
  it("extracts sub claim", () => {
    const token = fakeJwt({ sub: "user-abc-123", exp: 9999999999 });
    expect(getUserIdFromToken(token)).toBe("user-abc-123");
  });

  it("returns null for token without sub", () => {
    const token = fakeJwt({ exp: 9999999999 });
    expect(getUserIdFromToken(token)).toBeNull();
  });

  it("returns null for malformed token", () => {
    expect(getUserIdFromToken("garbage")).toBeNull();
  });
});
