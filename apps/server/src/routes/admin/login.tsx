import { Hono } from "hono";
import { AdminLayout } from "../../views/admin/layout.js";
import { createAdminCookie, adminCookieHeader } from "./middleware.js";

export const loginRoutes = new Hono();

loginRoutes.get("/", (c) => {
  const error = c.req.query("error");
  return c.html(
    <AdminLayout title="Login">
      <div class="login-form card">
        <h1>Admin Login</h1>
        {error && <div class="error">Invalid password</div>}
        <form method="POST" action="/api/admin/login">
          <input type="password" name="password" placeholder="Admin secret" autofocus required />
          <button type="submit" class="btn btn-primary">
            Log in
          </button>
        </form>
      </div>
    </AdminLayout>,
  );
});

loginRoutes.post("/", async (c) => {
  const body = await c.req.parseBody();
  const password = body["password"] as string;

  if (password !== process.env.ADMIN_SECRET) {
    return c.redirect("/api/admin/login?error=1");
  }

  const cookie = createAdminCookie();
  c.header("Set-Cookie", adminCookieHeader(cookie));
  return c.redirect("/api/admin/users");
});
