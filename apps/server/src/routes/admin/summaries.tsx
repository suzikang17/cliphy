import { Hono } from "hono";
import { supabase } from "../../lib/supabase.js";
import { AdminLayout } from "../../views/admin/layout.js";
import { StatusBadge, Pagination } from "../../views/admin/components.js";

interface SummaryListRow {
  id: string;
  video_title: string | null;
  youtube_video_id: string;
  status: string;
  tags: string[] | null;
  created_at: string;
  users: { email: string };
}

interface SummaryDetailRow {
  id: string;
  video_title: string | null;
  youtube_video_id: string;
  video_channel: string | null;
  video_duration_seconds: number | null;
  status: string;
  tags: string[] | null;
  created_at: string;
  error_message: string | null;
  summary_json: unknown;
  transcript: string | null;
  users: { email: string; plan: string; id: string };
}

export const adminSummaryRoutes = new Hono();

const PER_PAGE = 25;

// ─── Summary list ─────────────────────────────────────────────────────────────

adminSummaryRoutes.get("/", async (c) => {
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10));
  const status = c.req.query("status") ?? "";
  const from_date = c.req.query("from") ?? "";
  const to_date = c.req.query("to") ?? "";
  const search = c.req.query("search") ?? "";
  const isHtmx = c.req.header("HX-Request") === "true";

  const from = (page - 1) * PER_PAGE;
  const to = from + PER_PAGE - 1;

  let query = supabase
    .from("summaries")
    .select("id, video_title, youtube_video_id, status, tags, created_at, users!inner(email)", {
      count: "exact",
    })
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (status && status !== "all") query = query.eq("status", status);
  if (from_date) query = query.not("created_at", "lt", from_date);
  if (to_date) query = query.not("created_at", "gt", `${to_date}T23:59:59Z`);
  if (search) {
    const sanitized = search.replace(/%/g, "\\%").replace(/_/g, "\\_");
    query = query.or(`video_title.ilike.%${sanitized}%,youtube_video_id.eq.${sanitized}`);
  }

  const { data: summaries, count } = await query;

  const baseUrl = buildBaseUrl({ status, from: from_date, to: to_date, search });

  const tableFragment = (
    <div id="summaries-table">
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>User</th>
            <th>Status</th>
            <th>Tags</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {(summaries ?? []).map((s: SummaryListRow) => (
            <tr
              key={s.id}
              style="cursor:pointer"
              onclick={`window.location='/api/admin/summaries/${s.id}'`}
            >
              <td>{s.video_title ?? s.youtube_video_id}</td>
              <td style="font-size:0.85rem;color:#666">{s.users?.email ?? "—"}</td>
              <td>
                <StatusBadge status={s.status} />
              </td>
              <td style="font-size:0.8rem;color:#666">{(s.tags ?? []).join(", ") || "—"}</td>
              <td>{formatDate(s.created_at)}</td>
            </tr>
          ))}
          {(summaries ?? []).length === 0 && (
            <tr>
              <td colspan={5} style="text-align:center;color:#999;padding:2rem">
                No summaries found
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
        targetId="summaries-table"
      />
    </div>
  );

  if (isHtmx) return c.html(tableFragment);

  return c.html(
    <AdminLayout title="Summaries">
      <h1>Summaries</h1>
      <div class="filters">
        <select
          name="status"
          hx-get="/api/admin/summaries"
          hx-target="#summaries-table"
          hx-swap="outerHTML"
          hx-include="[name]"
        >
          <option value="all" selected={!status || status === "all"}>
            All statuses
          </option>
          <option value="pending" selected={status === "pending"}>
            Pending
          </option>
          <option value="processing" selected={status === "processing"}>
            Processing
          </option>
          <option value="completed" selected={status === "completed"}>
            Completed
          </option>
          <option value="failed" selected={status === "failed"}>
            Failed
          </option>
        </select>
        <input
          type="date"
          name="from"
          value={from_date}
          hx-get="/api/admin/summaries"
          hx-target="#summaries-table"
          hx-swap="outerHTML"
          hx-include="[name]"
          hx-trigger="change"
        />
        <input
          type="date"
          name="to"
          value={to_date}
          hx-get="/api/admin/summaries"
          hx-target="#summaries-table"
          hx-swap="outerHTML"
          hx-include="[name]"
          hx-trigger="change"
        />
        <input
          type="search"
          name="search"
          placeholder="Search by title or video ID…"
          value={search}
          hx-get="/api/admin/summaries"
          hx-target="#summaries-table"
          hx-swap="outerHTML"
          hx-include="[name]"
          hx-trigger="keyup changed delay:300ms"
        />
      </div>
      {tableFragment}
    </AdminLayout>,
  );
});

// ─── Summary detail ───────────────────────────────────────────────────────────

adminSummaryRoutes.get("/:id", async (c) => {
  const summaryId = c.req.param("id");

  const { data: summary, error } = await supabase
    .from("summaries")
    .select("*, users!inner(email, plan, id)")
    .eq("id", summaryId)
    .single();

  if (error || !summary) {
    return c.html(
      <AdminLayout title="Summary not found">
        <h1>Summary not found</h1>
      </AdminLayout>,
      404,
    );
  }

  const s = summary as SummaryDetailRow;
  const videoUrl = `https://www.youtube.com/watch?v=${s.youtube_video_id}`;
  const durationMin =
    s.video_duration_seconds != null ? `${Math.round(s.video_duration_seconds / 60)}min` : "—";
  const transcriptPreview = s.transcript
    ? s.transcript.length > 500
      ? s.transcript.slice(0, 500) + "..."
      : s.transcript
    : null;

  return c.html(
    <AdminLayout title={s.video_title ?? s.youtube_video_id}>
      <div style="margin-bottom:1rem">
        <a href="/api/admin/summaries" style="color:#666;text-decoration:none">
          ← Back to Summaries
        </a>
      </div>
      <h1>{s.video_title ?? s.youtube_video_id}</h1>

      <div class="detail-grid section">
        {/* Video info card */}
        <div class="card">
          <h2>Video</h2>
          <div class="detail-row">
            <span class="label">YouTube ID</span>
            <span style="font-size:0.85rem;font-family:monospace">{s.youtube_video_id}</span>
          </div>
          <div class="detail-row">
            <span class="label">Channel</span>
            <span>{s.video_channel ?? "—"}</span>
          </div>
          <div class="detail-row">
            <span class="label">Duration</span>
            <span>{durationMin}</span>
          </div>
          <div class="detail-row">
            <span class="label">URL</span>
            <span>
              <a
                href={videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                style="font-size:0.85rem"
              >
                {videoUrl}
              </a>
            </span>
          </div>
          <div class="detail-row">
            <span class="label">Status</span>
            <span>
              <StatusBadge status={s.status} />
            </span>
          </div>
          <div class="detail-row">
            <span class="label">Tags</span>
            <span style="font-size:0.85rem;color:#666">{(s.tags ?? []).join(", ") || "—"}</span>
          </div>
          <div class="detail-row">
            <span class="label">Created</span>
            <span>{formatDate(s.created_at)}</span>
          </div>
        </div>

        {/* User card */}
        <div class="card">
          <h2>User</h2>
          <div class="detail-row">
            <span class="label">Email</span>
            <span>{s.users.email}</span>
          </div>
          <div class="detail-row">
            <span class="label">Plan</span>
            <span>{s.users.plan}</span>
          </div>
          <div class="detail-row">
            <span class="label">User ID</span>
            <span style="font-size:0.8rem">
              <a href={`/api/admin/users/${s.users.id}`} style="color:#666;font-family:monospace">
                {s.users.id}
              </a>
            </span>
          </div>
        </div>
      </div>

      {/* Error section */}
      {s.status === "failed" && s.error_message && (
        <div class="section">
          <div class="card">
            <h2>Error</h2>
            <pre style="background:#fff5f5;border:1px solid #fed7d7;padding:1rem;border-radius:4px;overflow:auto;font-size:0.8rem;color:#c53030;white-space:pre-wrap;word-break:break-all">
              {s.error_message}
            </pre>
          </div>
        </div>
      )}

      {/* Summary JSON section */}
      <div class="section">
        <div class="card">
          <h2>Summary JSON</h2>
          <pre style="background:#f7f7f7;border:1px solid #e2e8f0;padding:1rem;border-radius:4px;overflow:auto;font-size:0.8rem;white-space:pre-wrap;word-break:break-all">
            {s.summary_json != null ? JSON.stringify(s.summary_json, null, 2) : "—"}
          </pre>
        </div>
      </div>

      {/* Transcript preview */}
      {transcriptPreview && (
        <div class="section">
          <div class="card">
            <h2>Transcript Preview</h2>
            <pre style="background:#f7f7f7;border:1px solid #e2e8f0;padding:1rem;border-radius:4px;overflow:auto;font-size:0.8rem;white-space:pre-wrap;word-break:break-word">
              {transcriptPreview}
            </pre>
          </div>
        </div>
      )}
    </AdminLayout>,
  );
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function buildBaseUrl(params: {
  status: string;
  from: string;
  to: string;
  search: string;
}): string {
  const parts: string[] = [];
  if (params.status && params.status !== "all")
    parts.push(`status=${encodeURIComponent(params.status)}`);
  if (params.from) parts.push(`from=${encodeURIComponent(params.from)}`);
  if (params.to) parts.push(`to=${encodeURIComponent(params.to)}`);
  if (params.search) parts.push(`search=${encodeURIComponent(params.search)}`);
  return parts.length ? `/api/admin/summaries?${parts.join("&")}` : "/api/admin/summaries";
}
