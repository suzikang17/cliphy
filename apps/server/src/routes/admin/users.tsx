import { Hono } from "hono";
import { supabase } from "../../lib/supabase.js";
import { AdminLayout } from "../../views/admin/layout.js";
import { StatusBadge, PlanBadge, Pagination } from "../../views/admin/components.js";
import {
  downgradeUser,
  upgradeUser,
  cancelSubscription,
  resetMonthlyCount,
} from "../../services/admin.js";

interface UserRow {
  id: string;
  email: string;
  plan: string;
  subscription_status: string;
  monthly_summary_count: number;
  created_at: string;
}

interface SummaryRow {
  id: string;
  video_title: string | null;
  status: string;
  created_at: string;
}

export const adminUserRoutes = new Hono();

const PER_PAGE = 25;

// ─── User list ───────────────────────────────────────────────────────────────

adminUserRoutes.get("/", async (c) => {
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10));
  const plan = c.req.query("plan") ?? "";
  const status = c.req.query("status") ?? "";
  const search = c.req.query("search") ?? "";
  const isHtmx = c.req.header("HX-Request") === "true";

  const from = (page - 1) * PER_PAGE;
  const to = from + PER_PAGE - 1;

  let query = supabase
    .from("users")
    .select("id, email, plan, subscription_status, monthly_summary_count, created_at", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (plan && plan !== "all") query = query.eq("plan", plan);
  if (status && status !== "all") query = query.eq("subscription_status", status);
  if (search) query = query.ilike("email", `%${search}%`);

  const { data: users, count } = await query;

  const baseUrl = buildBaseUrl({ plan, status, search });

  const tableFragment = (
    <div id="users-table">
      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>Plan</th>
            <th>Status</th>
            <th>Monthly Count</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {(users ?? []).map((u: UserRow) => (
            <tr
              key={u.id}
              style="cursor:pointer"
              onclick={`window.location='/api/admin/users/${u.id}'`}
            >
              <td>{u.email}</td>
              <td>
                <PlanBadge plan={u.plan} />
              </td>
              <td>
                <StatusBadge status={u.subscription_status} />
              </td>
              <td>{u.monthly_summary_count}</td>
              <td>{formatDate(u.created_at)}</td>
            </tr>
          ))}
          {(users ?? []).length === 0 && (
            <tr>
              <td colspan={5} style="text-align:center;color:#999;padding:2rem">
                No users found
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <Pagination
        page={page}
        total={count ?? 0}
        perPage={PER_PAGE}
        baseUrl={baseUrl}
        targetId="users-table"
      />
    </div>
  );

  if (isHtmx) return c.html(tableFragment);

  return c.html(
    <AdminLayout title="Users">
      <h1>Users</h1>
      <div class="filters">
        <select
          name="plan"
          hx-get="/api/admin/users"
          hx-target="#users-table"
          hx-swap="outerHTML"
          hx-include="[name]"
        >
          <option value="all" selected={!plan || plan === "all"}>
            All plans
          </option>
          <option value="free" selected={plan === "free"}>
            Free
          </option>
          <option value="pro" selected={plan === "pro"}>
            Pro
          </option>
        </select>
        <select
          name="status"
          hx-get="/api/admin/users"
          hx-target="#users-table"
          hx-swap="outerHTML"
          hx-include="[name]"
        >
          <option value="all" selected={!status || status === "all"}>
            All statuses
          </option>
          <option value="none" selected={status === "none"}>
            None
          </option>
          <option value="active" selected={status === "active"}>
            Active
          </option>
          <option value="trialing" selected={status === "trialing"}>
            Trialing
          </option>
          <option value="past_due" selected={status === "past_due"}>
            Past due
          </option>
          <option value="canceled" selected={status === "canceled"}>
            Canceled
          </option>
        </select>
        <input
          type="search"
          name="search"
          placeholder="Search by email…"
          value={search}
          hx-get="/api/admin/users"
          hx-target="#users-table"
          hx-swap="outerHTML"
          hx-include="[name]"
          hx-trigger="keyup changed delay:300ms"
        />
      </div>
      {tableFragment}
    </AdminLayout>,
  );
});

// ─── User detail ─────────────────────────────────────────────────────────────

adminUserRoutes.get("/:id", async (c) => {
  const userId = c.req.param("id");

  const { data: user, error: userErr } = await supabase
    .from("users")
    .select(
      "id, email, plan, subscription_status, stripe_customer_id, stripe_subscription_id, trial_ends_at, monthly_summary_count, monthly_count_reset_at, created_at",
    )
    .eq("id", userId)
    .single();

  if (userErr || !user) {
    return c.html(
      <AdminLayout title="User not found">
        <h1>User not found</h1>
      </AdminLayout>,
      404,
    );
  }

  const { data: summaries } = await supabase
    .from("summaries")
    .select("id, video_title, status, created_at")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(0, 19);

  const { count: totalSummaries } = await supabase
    .from("summaries")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("deleted_at", null);

  return c.html(
    <AdminLayout title={user.email}>
      <div style="margin-bottom:1rem">
        <a href="/api/admin/users" style="color:#666;text-decoration:none">
          ← Back to Users
        </a>
      </div>
      <h1>{user.email}</h1>

      <div class="detail-grid section">
        {/* Profile card */}
        <div class="card">
          <h2>Profile</h2>
          <div class="detail-row">
            <span class="label">Email</span>
            <span>{user.email}</span>
          </div>
          <div class="detail-row">
            <span class="label">Plan</span>
            <span>
              <PlanBadge plan={user.plan} />
            </span>
          </div>
          <div class="detail-row">
            <span class="label">Subscription status</span>
            <span>
              <StatusBadge status={user.subscription_status} />
            </span>
          </div>
          <div class="detail-row">
            <span class="label">Stripe customer</span>
            <span style="font-size:0.8rem;color:#666">{user.stripe_customer_id ?? "—"}</span>
          </div>
          <div class="detail-row">
            <span class="label">Stripe subscription</span>
            <span style="font-size:0.8rem;color:#666">{user.stripe_subscription_id ?? "—"}</span>
          </div>
          <div class="detail-row">
            <span class="label">Trial ends at</span>
            <span>{user.trial_ends_at ? formatDate(user.trial_ends_at) : "—"}</span>
          </div>
          <div class="detail-row">
            <span class="label">Created</span>
            <span>{formatDate(user.created_at)}</span>
          </div>
        </div>

        {/* Usage card */}
        <div class="card">
          <h2>Usage</h2>
          <div class="detail-row">
            <span class="label">Monthly count</span>
            <span>{user.monthly_summary_count}</span>
          </div>
          <div class="detail-row">
            <span class="label">Count reset at</span>
            <span>
              {user.monthly_count_reset_at ? formatDate(user.monthly_count_reset_at) : "—"}
            </span>
          </div>
          <div class="detail-row">
            <span class="label">Total summaries</span>
            <span>{totalSummaries ?? 0}</span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div class="section">
        <div id="user-actions" class="card">
          <h2>Actions</h2>
          <div class="actions">
            <button
              class="btn btn-primary"
              hx-post={`/api/admin/users/${userId}/upgrade`}
              hx-target="#user-actions"
              hx-swap="outerHTML"
              hx-confirm="Upgrade this user to Pro?"
            >
              Upgrade to Pro
            </button>
            <button
              class="btn btn-secondary"
              hx-post={`/api/admin/users/${userId}/downgrade`}
              hx-target="#user-actions"
              hx-swap="outerHTML"
              hx-confirm="Downgrade this user to Free? This will cancel their Stripe subscription."
            >
              Downgrade to Free
            </button>
            <button
              class="btn btn-danger"
              hx-post={`/api/admin/users/${userId}/cancel-subscription`}
              hx-target="#user-actions"
              hx-swap="outerHTML"
              hx-confirm="Cancel this user's Stripe subscription?"
            >
              Cancel subscription
            </button>
            <button
              class="btn btn-secondary"
              hx-post={`/api/admin/users/${userId}/reset-count`}
              hx-target="#user-actions"
              hx-swap="outerHTML"
              hx-confirm="Reset this user's monthly count to 0?"
            >
              Reset monthly count
            </button>
          </div>
        </div>
      </div>

      {/* Recent summaries */}
      <div class="section">
        <h2>Recent Summaries</h2>
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {(summaries ?? []).map((s: SummaryRow) => (
              <tr key={s.id}>
                <td>{s.video_title ?? "Untitled"}</td>
                <td>
                  <StatusBadge status={s.status} />
                </td>
                <td>{formatDate(s.created_at)}</td>
              </tr>
            ))}
            {(summaries ?? []).length === 0 && (
              <tr>
                <td colspan={3} style="text-align:center;color:#999;padding:2rem">
                  No summaries yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AdminLayout>,
  );
});

// ─── Action endpoints ─────────────────────────────────────────────────────────

adminUserRoutes.post("/:id/upgrade", async (c) => {
  const userId = c.req.param("id");
  try {
    await upgradeUser(userId);
    return c.html(actionsFragment(userId, "User upgraded to Pro."));
  } catch (err: unknown) {
    return c.html(actionsFragment(userId, undefined, (err as Error).message));
  }
});

adminUserRoutes.post("/:id/downgrade", async (c) => {
  const userId = c.req.param("id");
  try {
    await downgradeUser(userId);
    return c.html(actionsFragment(userId, "User downgraded to Free."));
  } catch (err: unknown) {
    return c.html(actionsFragment(userId, undefined, (err as Error).message));
  }
});

adminUserRoutes.post("/:id/cancel-subscription", async (c) => {
  const userId = c.req.param("id");
  try {
    await cancelSubscription(userId);
    return c.html(actionsFragment(userId, "Subscription canceled."));
  } catch (err: unknown) {
    return c.html(actionsFragment(userId, undefined, (err as Error).message));
  }
});

adminUserRoutes.post("/:id/reset-count", async (c) => {
  const userId = c.req.param("id");
  try {
    await resetMonthlyCount(userId);
    return c.html(actionsFragment(userId, "Monthly count reset."));
  } catch (err: unknown) {
    return c.html(actionsFragment(userId, undefined, (err as Error).message));
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function buildBaseUrl(params: { plan: string; status: string; search: string }): string {
  const parts: string[] = [];
  if (params.plan && params.plan !== "all") parts.push(`plan=${encodeURIComponent(params.plan)}`);
  if (params.status && params.status !== "all")
    parts.push(`status=${encodeURIComponent(params.status)}`);
  if (params.search) parts.push(`search=${encodeURIComponent(params.search)}`);
  return parts.length ? `/api/admin/users?${parts.join("&")}` : "/api/admin/users";
}

function actionsFragment(userId: string, success?: string, error?: string) {
  return (
    <div id="user-actions" class="card">
      <h2>Actions</h2>
      {success && <div class="success">{success}</div>}
      {error && <div class="error">{error}</div>}
      <div class="actions">
        <button
          class="btn btn-primary"
          hx-post={`/api/admin/users/${userId}/upgrade`}
          hx-target="#user-actions"
          hx-swap="outerHTML"
          hx-confirm="Upgrade this user to Pro?"
        >
          Upgrade to Pro
        </button>
        <button
          class="btn btn-secondary"
          hx-post={`/api/admin/users/${userId}/downgrade`}
          hx-target="#user-actions"
          hx-swap="outerHTML"
          hx-confirm="Downgrade this user to Free? This will cancel their Stripe subscription."
        >
          Downgrade to Free
        </button>
        <button
          class="btn btn-danger"
          hx-post={`/api/admin/users/${userId}/cancel-subscription`}
          hx-target="#user-actions"
          hx-swap="outerHTML"
          hx-confirm="Cancel this user's Stripe subscription?"
        >
          Cancel subscription
        </button>
        <button
          class="btn btn-secondary"
          hx-post={`/api/admin/users/${userId}/reset-count`}
          hx-target="#user-actions"
          hx-swap="outerHTML"
          hx-confirm="Reset this user's monthly count to 0?"
        >
          Reset monthly count
        </button>
      </div>
    </div>
  );
}
