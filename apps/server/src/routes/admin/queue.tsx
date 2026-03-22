import { Hono } from "hono";
import { supabase } from "../../lib/supabase.js";
import { AdminLayout } from "../../views/admin/layout.js";
import { StatsCard, StatusBadge } from "../../views/admin/components.js";

interface QueueSummaryRow {
  id: string;
  video_title: string | null;
  youtube_video_id: string;
  status: string;
  created_at: string;
  users: { email: string };
}

export const adminQueueRoutes = new Hono();

// ─── Queue dashboard ──────────────────────────────────────────────────────────

adminQueueRoutes.get("/", async (c) => {
  const isHtmx = c.req.header("HX-Request") === "true";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMidnightISO = today.toISOString();

  const [pendingResult, processingResult, failedResult, completedTodayResult, recentResult] =
    await Promise.all([
      supabase
        .from("summaries")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .is("deleted_at", null),
      supabase
        .from("summaries")
        .select("id", { count: "exact", head: true })
        .eq("status", "processing")
        .is("deleted_at", null),
      supabase
        .from("summaries")
        .select("id", { count: "exact", head: true })
        .eq("status", "failed")
        .is("deleted_at", null),
      supabase
        .from("summaries")
        .select("id", { count: "exact", head: true })
        .eq("status", "completed")
        .gte("created_at", todayMidnightISO)
        .is("deleted_at", null),
      supabase
        .from("summaries")
        .select("id, video_title, youtube_video_id, status, created_at, users!inner(email)")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .range(0, 49),
    ]);

  const pendingCount = pendingResult.count ?? 0;
  const processingCount = processingResult.count ?? 0;
  const failedCount = failedResult.count ?? 0;
  const completedTodayCount = completedTodayResult.count ?? 0;
  const recentItems = (recentResult.data ?? []) as QueueSummaryRow[];

  const queueContent = (
    <div
      id="queue-content"
      hx-get="/api/admin/queue"
      hx-trigger="every 10s"
      hx-target="#queue-content"
      hx-swap="outerHTML"
      hx-select="#queue-content"
    >
      <div class="stats-grid">
        <StatsCard label="Pending" value={pendingCount} badge="pending" />
        <StatsCard label="Processing" value={processingCount} badge="processing" />
        <StatsCard label="Failed" value={failedCount} badge="failed" />
        <StatsCard label="Completed Today" value={completedTodayCount} badge="completed" />
      </div>

      <div class="section">
        <h2>Recent Items</h2>
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>User</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {recentItems.map((s: QueueSummaryRow) => (
              <tr
                key={s.id}
                style="cursor:pointer"
                onclick={`window.location='/api/admin/summaries/${s.id}'`}
              >
                <td>{s.video_title ?? "Untitled"}</td>
                <td>{s.users?.email ?? "—"}</td>
                <td>
                  <StatusBadge status={s.status} />
                </td>
                <td>{formatDate(s.created_at)}</td>
              </tr>
            ))}
            {recentItems.length === 0 && (
              <tr>
                <td colspan={4} style="text-align:center;color:#999;padding:2rem">
                  No summaries found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  if (isHtmx) return c.html(queueContent);

  return c.html(
    <AdminLayout title="Queue">
      <h1>Queue Monitor</h1>
      {queueContent}
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
