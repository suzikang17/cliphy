import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// Mock env
vi.stubEnv("ADMIN_SECRET", "test-secret-123");

async function createTestApp() {
  const { adminAuthMiddleware, createAdminCookie, verifyAdminCookie } =
    await import("../middleware.js");
  const app = new Hono();
  app.use("/admin/*", adminAuthMiddleware);
  app.get("/admin/test", (c) => c.text("ok"));
  return { app, createAdminCookie, verifyAdminCookie };
}

describe("Admin Auth Middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to login when no cookie", async () => {
    const { app } = await createTestApp();
    const res = await app.request("/admin/test");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/api/admin/login");
  });

  it("rejects invalid cookie signature", async () => {
    const { app } = await createTestApp();
    const res = await app.request("/admin/test", {
      headers: { Cookie: "admin_session=fake.invalidsig" },
    });
    expect(res.status).toBe(302);
  });

  it("allows valid cookie", async () => {
    const { app, createAdminCookie } = await createTestApp();
    const cookie = createAdminCookie();
    const res = await app.request("/admin/test", {
      headers: { Cookie: `admin_session=${cookie}` },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("createAdminCookie and verifyAdminCookie round-trip", async () => {
    const { createAdminCookie, verifyAdminCookie } = await createTestApp();
    const cookie = createAdminCookie();
    expect(verifyAdminCookie(cookie)).toBe(true);
  });

  it("verifyAdminCookie rejects tampered value", async () => {
    const { verifyAdminCookie } = await createTestApp();
    expect(verifyAdminCookie("tampered.value")).toBe(false);
  });
});
