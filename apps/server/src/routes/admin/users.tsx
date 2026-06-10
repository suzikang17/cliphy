import { Hono } from "hono";
import type { Context } from "hono";
import { supabase } from "../../lib/supabase.js";
import { AdminLayout } from "../../views/admin/layout.js";
import { StatusBadge, PlanBadge, Pagination } from "../../views/admin/components.js";
import { formatDate, formatDateTime } from "../../views/admin/format.js";
import {
  downgradeUser,
  upgradeUser,
  cancelSubscription,
  resetMonthlyCount,
  grantCredits,
  setMonthlyBonus,
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

interface UserDetail {
  id: string;
  email: string;
  plan: string;
  subscription_status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  trial_ends_at: string | null;
  monthly_summary_count: number;
  monthly_count_reset_at: string | null;
  monthly_limit_bonus: number;
  bonus_credits: number;
  created_at: string;
}

const USER_DETAIL_COLUMNS =
  "id, email, plan, subscription_status, stripe_customer_id, stripe_subscription_id, trial_ends_at, monthly_summary_count, monthly_count_reset_at, monthly_limit_bonus, bonus_credits, created_at";

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
              <td>{formatDateTime(u.created_at)}</td>
            </tr>
          ))}
          {(users ?? []).length === 0 && (
            <tr>
              <td colspan={5} style="text-align:center;color:var(--text-faint);padding:2rem">
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
    .select(USER_DETAIL_COLUMNS)
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
        <a href="/api/admin/users" style="color:var(--text-muted);text-decoration:none">
          ← Back to Users
        </a>
      </div>
      <h1>{user.email}</h1>

      {userCards(user as UserDetail, totalSummaries ?? 0)}

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
                <td>
                  <a href={`/api/admin/summaries/${s.id}`}>{s.video_title ?? "Untitled"}</a>
                </td>
                <td>
                  <StatusBadge status={s.status} />
                </td>
                <td>{formatDateTime(s.created_at)}</td>
              </tr>
            ))}
            {(summaries ?? []).length === 0 && (
              <tr>
                <td colspan={3} style="text-align:center;color:var(--text-faint);padding:2rem">
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

adminUserRoutes.post("/:id/upgrade", (c) =>
  runAction(c, () => upgradeUser(c.req.param("id")), "User upgraded to Pro."),
);

adminUserRoutes.post("/:id/downgrade", (c) =>
  runAction(c, () => downgradeUser(c.req.param("id")), "User downgraded to Free."),
);

adminUserRoutes.post("/:id/cancel-subscription", (c) =>
  runAction(c, () => cancelSubscription(c.req.param("id")), "Subscription canceled."),
);

adminUserRoutes.post("/:id/reset-count", (c) =>
  runAction(c, () => resetMonthlyCount(c.req.param("id")), "Monthly count reset."),
);

adminUserRoutes.post("/:id/grant-credits", async (c) => {
  const userId = c.req.param("id");
  const body = await c.req.parseBody();
  const amount = Number(body["amount"]);
  return runAction(
    c,
    () => grantCredits(userId, amount),
    `${amount > 0 ? "Granted" : "Removed"} ${Math.abs(amount)} one-off credit(s).`,
  );
});

adminUserRoutes.post("/:id/set-monthly-bonus", async (c) => {
  const userId = c.req.param("id");
  const body = await c.req.parseBody();
  const bonus = Number(body["bonus"]);
  return runAction(
    c,
    () => setMonthlyBonus(userId, bonus),
    `Recurring monthly bonus set to +${bonus}.`,
  );
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildBaseUrl(params: { plan: string; status: string; search: string }): string {
  const parts: string[] = [];
  if (params.plan && params.plan !== "all") parts.push(`plan=${encodeURIComponent(params.plan)}`);
  if (params.status && params.status !== "all")
    parts.push(`status=${encodeURIComponent(params.status)}`);
  if (params.search) parts.push(`search=${encodeURIComponent(params.search)}`);
  return parts.length ? `/api/admin/users?${parts.join("&")}` : "/api/admin/users";
}

async function fetchUserCards(
  userId: string,
): Promise<{ user: UserDetail; totalSummaries: number } | null> {
  const { data: user, error } = await supabase
    .from("users")
    .select(USER_DETAIL_COLUMNS)
    .eq("id", userId)
    .single();

  if (error || !user) return null;

  const { count } = await supabase
    .from("summaries")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("deleted_at", null);

  return { user: user as UserDetail, totalSummaries: count ?? 0 };
}

// Run a mutation, then re-render the cards with the updated values + a message.
async function runAction(c: Context, fn: () => Promise<void>, successMsg: string) {
  let success: string | undefined;
  let error: string | undefined;
  try {
    await fn();
    success = successMsg;
  } catch (err: unknown) {
    error = (err as Error).message;
  }

  const userId = c.req.param("id");
  const data = userId ? await fetchUserCards(userId) : null;
  if (!data) return c.html(<div class="error">User not found</div>, 404);
  return c.html(userCards(data.user, data.totalSummaries, success, error));
}

function userCards(user: UserDetail, totalSummaries: number, success?: string, error?: string) {
  const userId = user.id;
  const swap = { "hx-target": "#user-cards", "hx-swap": "outerHTML" } as const;

  // The stored counter resets lazily (only on the user's next summary), so it can
  // be stale across months. Mirror usage.ts to show the effective current-month count.
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  const monthStartStr = monthStart.toISOString().slice(0, 10);
  const rawCount = user.monthly_summary_count;
  const effectiveCount =
    user.monthly_count_reset_at && user.monthly_count_reset_at >= monthStartStr ? rawCount : 0;
  const countIsStale = effectiveCount !== rawCount;
  return (
    <div class="detail-grid section" id="user-cards">
      {(success || error) && (
        <div style="grid-column:1/-1">
          {success && <div class="success">{success}</div>}
          {error && <div class="error">{error}</div>}
        </div>
      )}

      {/* Profile card */}
      <div class="card">
        <h2>Profile</h2>
        <div class="detail-row">
          <span class="label">Email</span>
          <span>{user.email}</span>
        </div>
        <div class="detail-row">
          <span class="label">Plan</span>
          <span class="field-actions">
            <PlanBadge plan={user.plan} />
            <button
              class="btn btn-primary btn-sm"
              hx-post={`/api/admin/users/${userId}/upgrade`}
              {...swap}
              hx-confirm="Upgrade this user to Pro?"
            >
              Upgrade
            </button>
            <button
              class="btn btn-secondary btn-sm"
              hx-post={`/api/admin/users/${userId}/downgrade`}
              {...swap}
              hx-confirm="Downgrade this user to Free? This will cancel their Stripe subscription."
            >
              Downgrade
            </button>
          </span>
        </div>
        <div class="detail-row">
          <span class="label">Subscription status</span>
          <span class="field-actions">
            <StatusBadge status={user.subscription_status} />
            <button
              class="btn btn-danger btn-sm"
              hx-post={`/api/admin/users/${userId}/cancel-subscription`}
              {...swap}
              hx-confirm="Cancel this user's Stripe subscription?"
            >
              Cancel
            </button>
          </span>
        </div>
        <div class="detail-row">
          <span class="label">Stripe customer</span>
          <span style="font-size:0.8rem;color:var(--text-muted)">
            {user.stripe_customer_id ?? "—"}
          </span>
        </div>
        <div class="detail-row">
          <span class="label">Stripe subscription</span>
          <span style="font-size:0.8rem;color:var(--text-muted)">
            {user.stripe_subscription_id ?? "—"}
          </span>
        </div>
        <div class="detail-row">
          <span class="label">Trial ends at</span>
          <span>{user.trial_ends_at ? formatDate(user.trial_ends_at) : "—"}</span>
        </div>
        <div class="detail-row">
          <span class="label">Created</span>
          <span>{formatDateTime(user.created_at)}</span>
        </div>
      </div>

      {/* Usage card */}
      <div class="card">
        <h2>Usage</h2>
        <div class="detail-row">
          <span class="label">Monthly count</span>
          <span class="field-actions">
            <span>
              {effectiveCount} this month
              {countIsStale && (
                <span style="color:var(--text-muted);font-size:0.8rem">
                  {" "}
                  (raw: {rawCount}
                  {user.monthly_count_reset_at
                    ? `, last reset ${formatDate(user.monthly_count_reset_at)}`
                    : ""}
                  )
                </span>
              )}
            </span>
            <button
              class="btn btn-secondary btn-sm"
              hx-post={`/api/admin/users/${userId}/reset-count`}
              {...swap}
              hx-confirm="Reset this user's monthly count to 0?"
            >
              Reset
            </button>
          </span>
        </div>
        <div class="detail-row">
          <span class="label">Count reset at</span>
          <span>{user.monthly_count_reset_at ? formatDate(user.monthly_count_reset_at) : "—"}</span>
        </div>
        <div class="detail-row">
          <span class="label" title="Added to the plan limit every month">
            Monthly bonus
          </span>
          <span class="field-actions">
            <span>+{user.monthly_limit_bonus ?? 0} / mo</span>
            <form
              class="field-actions"
              hx-post={`/api/admin/users/${userId}/set-monthly-bonus`}
              {...swap}
            >
              <input type="number" name="bonus" min="0" step="1" required placeholder="#" />
              <button class="btn btn-secondary btn-sm" type="submit">
                Set
              </button>
            </form>
          </span>
        </div>
        <div class="detail-row">
          <span class="label" title="One-off wallet, spent after the monthly allowance runs out">
            One-off credits
          </span>
          <span class="field-actions">
            <span>{user.bonus_credits ?? 0} left</span>
            <form
              class="field-actions"
              hx-post={`/api/admin/users/${userId}/grant-credits`}
              {...swap}
            >
              <input type="number" name="amount" step="1" required placeholder="+/−" />
              <button class="btn btn-primary btn-sm" type="submit">
                Grant
              </button>
            </form>
          </span>
        </div>
        <div class="detail-row">
          <span class="label">Total summaries</span>
          <span>{totalSummaries}</span>
        </div>
      </div>
    </div>
  );
}
