/**
 * Read-only: where accounts came from and what they did, as counts.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… tsx scripts/account-breakdown.ts
 *
 * Writes nothing. Prints totals only: no emails, names, ids or titles.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const DAY = 86_400_000;
const tally = (items: string[]) => {
  const m = new Map<string, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
};
const show = (title: string, rows: [string, number][]) => {
  console.log(`\n${title}`);
  for (const [k, n] of rows) console.log(`  ${k}: ${n}`);
};
const since = (iso: string | null | undefined) => {
  if (!iso) return "never";
  const d = (Date.now() - new Date(iso).getTime()) / DAY;
  return d <= 7
    ? "a) last 7 days"
    : d <= 30
      ? "b) 8-30 days"
      : d <= 90
        ? "c) 31-90 days"
        : "d) over 90 days";
};
const CONSUMER =
  /@(gmail|googlemail|outlook|hotmail|live|yahoo|icloud|me|proton|protonmail|aol)\./i;

async function all<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

async function main() {
  const authUsers = [];
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`auth users: ${error.message}`);
    authUsers.push(...data.users);
    if (data.users.length < 1000) break;
  }
  console.log(`Sign-in accounts: ${authUsers.length}`);

  show(
    "Signed up with",
    tally(
      authUsers.map((u) =>
        u.is_anonymous ? "anonymous" : (u.app_metadata?.provider ?? "unknown"),
      ),
    ),
  );
  show("Sign-ups per month", tally(authUsers.map((u) => u.created_at.slice(0, 7))));
  show(
    "Busiest sign-up days (top 5)",
    tally(authUsers.map((u) => u.created_at.slice(0, 10)))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5),
  );
  show("Last signed in", tally(authUsers.map((u) => since(u.last_sign_in_at))));
  show(
    "Signed in again after the first day",
    tally(
      authUsers.map((u) =>
        u.last_sign_in_at &&
        new Date(u.last_sign_in_at).getTime() - new Date(u.created_at).getTime() > DAY
          ? "yes"
          : "no",
      ),
    ),
  );
  show(
    "Email kind",
    tally(
      authUsers.map((u) =>
        !u.email ? "none" : CONSUMER.test(u.email) ? "personal mailbox" : "other domain",
      ),
    ),
  );
  show(
    "Email has a +tag (often a test address)",
    tally(authUsers.map((u) => (u.email?.split("@")[0].includes("+") ? "yes" : "no"))),
  );

  const users = await all<{
    id: string;
    plan: string;
    monthly_summary_count: number;
    last_active_at: string | null;
  }>("users", "id, plan, monthly_summary_count, last_active_at");
  show("Last active (server saw a request)", tally(users.map((u) => since(u.last_active_at))));

  const clips = await all<{ user_id: string; status: string; source_type: string }>(
    "clips",
    "user_id, status, source_type",
  );
  const perUser = new Map<string, { total: number; completed: number }>();
  for (const c of clips) {
    const p = perUser.get(c.user_id) ?? { total: 0, completed: 0 };
    p.total++;
    if (c.status === "completed") p.completed++;
    perUser.set(c.user_id, p);
  }
  const bucket = (n: number) =>
    n === 0 ? "a) 0" : n === 1 ? "b) 1" : n <= 5 ? "c) 2-5" : n <= 20 ? "d) 6-20" : "e) over 20";
  show("Clips saved per account", tally(users.map((u) => bucket(perUser.get(u.id)?.total ?? 0))));
  show(
    "Finished summaries per account",
    tally(users.map((u) => bucket(perUser.get(u.id)?.completed ?? 0))),
  );
  show("All clips by status", tally(clips.map((c) => c.status)));
  show("All clips by kind", tally(clips.map((c) => c.source_type)));

  const counts = [...perUser.values()].map((p) => p.total).sort((a, b) => b - a);
  console.log(
    `\nClips held by the 3 busiest accounts: ${counts.slice(0, 3).join(", ")} of ${clips.length}`,
  );

  for (const [label, table] of [
    ["has the phone app registered for notifications", "push_tokens"],
    ["has an API key (Shortcut, Mac app, Claude Code)", "api_keys"],
    ["has an auto-subscription", "subscriptions"],
  ] as const) {
    const rows = await all<{ user_id: string }>(table, "user_id");
    console.log(`Accounts that ${label}: ${new Set(rows.map((r) => r.user_id)).size}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
