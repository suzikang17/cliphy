import type { FC } from "hono/jsx";

// Stats card for dashboard numbers
export const StatsCard: FC<{ label: string; value: string | number; badge?: string }> = ({
  label,
  value,
  badge,
}) => (
  <div class="stat-card">
    <div class="value">
      {value}
      {badge && (
        <span class={`badge badge-${badge}`} style="font-size:0.5em;margin-left:0.5rem">
          {badge}
        </span>
      )}
    </div>
    <div class="label">{label}</div>
  </div>
);

// Status badge
export const StatusBadge: FC<{ status: string }> = ({ status }) => (
  <span class={`badge badge-${status}`}>{status}</span>
);

// Plan badge
export const PlanBadge: FC<{ plan: string }> = ({ plan }) => (
  <span class={`badge badge-${plan}`}>{plan}</span>
);

// Pagination controls
export const Pagination: FC<{
  page: number;
  total: number;
  perPage: number;
  baseUrl: string;
  targetId: string;
}> = ({ page, total, perPage, baseUrl, targetId }) => {
  const totalPages = Math.ceil(total / perPage);
  if (totalPages <= 1) return null;

  const separator = baseUrl.includes("?") ? "&" : "?";

  return (
    <div class="pagination">
      {page > 1 && (
        <button
          class="btn btn-secondary"
          hx-get={`${baseUrl}${separator}page=${page - 1}`}
          hx-target={`#${targetId}`}
          hx-swap="outerHTML"
        >
          ← Prev
        </button>
      )}
      <span style="padding:0.5rem;color:#666">
        Page {page} of {totalPages}
      </span>
      {page < totalPages && (
        <button
          class="btn btn-secondary"
          hx-get={`${baseUrl}${separator}page=${page + 1}`}
          hx-target={`#${targetId}`}
          hx-swap="outerHTML"
        >
          Next →
        </button>
      )}
    </div>
  );
};
