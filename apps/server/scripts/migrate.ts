/**
 * Safe, self-contained SQL migration runner.
 *
 * - Applies pending files from supabase/migrations/ in filename order.
 * - Each migration runs inside a transaction → a failure rolls back fully (no
 *   partial/half-applied state).
 * - Tracks applied versions in a `schema_migrations` table → only new ones run.
 * - Never runs on app boot — invoke as a deploy step, before the app deploys.
 *
 * Requires DATABASE_URL = your Postgres **direct/session** connection string
 * (Supabase → Settings → Database → Connection string → "Session pooler" or the
 * direct 5432 URL). Do NOT use the transaction pooler (port 6543) — it can't run
 * the multi-statement transactions migrations need.
 *
 * Usage:
 *   pnpm migrate            # apply all pending migrations
 *   pnpm migrate status     # show applied vs pending, run nothing
 *   pnpm migrate baseline 012   # mark 001..012 as applied WITHOUT running them
 *                               # (one-time, for migrations already applied by hand)
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../supabase/migrations");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required (Supabase direct/session connection string).");
  process.exit(1);
}

const [mode, arg] = process.argv.slice(2);

function versionOf(file: string): string {
  return file.split("_")[0]; // "013_error_category.sql" -> "013"
}

async function main() {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();

  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `create table if not exists schema_migrations (
         version text primary key,
         applied_at timestamptz not null default now()
       )`,
    );

    const { rows } = await client.query<{ version: string }>(
      "select version from schema_migrations",
    );
    const applied = new Set(rows.map((r) => r.version));
    const pending = files.filter((f) => !applied.has(versionOf(f)));

    if (mode === "status" || mode === "check") {
      console.log(`applied:  ${[...applied].sort().join(", ") || "(none)"}`);
      console.log(`pending:  ${pending.map(versionOf).join(", ") || "(none)"}`);
      // `check` is the CI gate: non-zero exit if any migration hasn't been applied.
      if (mode === "check" && pending.length > 0) {
        console.error(
          `\n✗ ${pending.length} unapplied migration(s). Run \`pnpm migrate\` before deploying.`,
        );
        process.exit(1);
      }
      return;
    }

    if (mode === "baseline") {
      if (!arg) {
        console.error("baseline requires an upper bound, e.g. `pnpm migrate baseline 012`");
        process.exit(1);
      }
      for (const f of files) {
        const v = versionOf(f);
        if (applied.has(v) || v > arg) continue;
        await client.query(
          "insert into schema_migrations(version) values($1) on conflict do nothing",
          [v],
        );
        console.log(`baselined ${f}  (recorded as applied, NOT executed)`);
      }
      return;
    }

    // default: apply pending, each in its own transaction
    if (pending.length === 0) {
      console.log("Up to date — no pending migrations.");
      return;
    }
    for (const f of pending) {
      const v = versionOf(f);
      const sql = await readFile(path.join(MIGRATIONS_DIR, f), "utf8");
      process.stdout.write(`applying ${f} … `);
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("insert into schema_migrations(version) values($1)", [v]);
        await client.query("COMMIT");
        console.log("✓");
      } catch (err) {
        await client.query("ROLLBACK");
        console.log("✗ rolled back (no partial changes)");
        throw err;
      }
    }
    console.log(`Done — applied ${pending.length} migration(s).`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
