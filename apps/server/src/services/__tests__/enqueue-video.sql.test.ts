import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

// The real SQL of migration 049 (enqueue_video), run in an embedded Postgres
// against the parts of the schema it touches and the real monthly-count
// function. These are the rules the server used to apply call by call.

const MIGRATIONS = path.resolve(__dirname, "../../../supabase/migrations");
const R = MIGRATIONS + "/";
const U = "11111111-1111-1111-1111-111111111111";
const P = "22222222-2222-2222-2222-222222222222";
const LIMITS = JSON.stringify({ free: 2, pro: 100 });
const SIGNATURE = "public.enqueue_video(uuid,text,text,text,text,integer,jsonb,integer,boolean)";

let db: PGlite;

type Saved = {
  outcome: string;
  row: Record<string, unknown>;
  position: number;
  limit: number;
  plan: string;
};

const save = async (user: string, video: string, opts: { title?: string; pos?: boolean } = {}) =>
  (
    await db.query<{ r: Saved }>(
      "select public.enqueue_video($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) as r",
      [
        user,
        video,
        "https://youtu.be/" + video,
        opts.title ?? null,
        null,
        null,
        LIMITS,
        60,
        opts.pos ?? false,
      ],
    )
  ).rows[0].r;

const month = async (user: string) =>
  (
    await db.query<{ c: number; b: number }>(
      "select monthly_summary_count c, bonus_credits b from users where id = $1",
      [user],
    )
  ).rows[0];

beforeAll(async () => {
  db = new PGlite();
  // The parts of the real schema the function touches.
  await db.exec(`
create role anon; create role authenticated; create role service_role;
create table public.users (id uuid primary key, plan text default 'free',
  monthly_summary_count integer not null default 0, monthly_count_reset_at date not null default current_date,
  monthly_limit_bonus integer not null default 0, bonus_credits integer not null default 0);
create table public.user_settings (user_id uuid primary key, summary_language text);
create table public.clips (id uuid primary key default gen_random_uuid(), user_id uuid not null,
  youtube_video_id text, video_title text, video_channel text, video_duration_seconds integer, video_url text,
  summary_language text, status text not null default 'pending', dedup_bucket bigint,
  source_type text not null default 'youtube', deleted_at timestamptz, created_at timestamptz not null default now());
create unique index summaries_user_video_bucket_uniq on public.clips (user_id, youtube_video_id, dedup_bucket)
  where status <> 'failed' and deleted_at is null and dedup_bucket is not null;
`);
  const m15 = readFileSync(R + "015_grant_credits.sql", "utf8");
  await db.exec(
    m15.slice(
      m15.indexOf("create or replace function public.increment_monthly_count(p_user_id"),
      m15.indexOf("comment on function public.increment_monthly_count is"),
    ),
  );
  await db.exec(readFileSync(R + "049_enqueue_video.sql", "utf8"));

  await db.exec(
    "insert into users (id, plan) values ('" +
      U +
      "','free'), ('" +
      P +
      "','pro');" +
      "insert into user_settings values ('" +
      P +
      "','ko');",
  );
}, 60_000);

// Each test builds on the rows the ones before it left, as a user's month does.
describe("enqueue_video", () => {
  it("saves a link as a pending row and counts it against the month", async () => {
    const r = await save(U, "aaa", { title: "" });
    expect(r.outcome).toBe("ok");
    expect(r.row).toMatchObject({
      status: "pending",
      summary_language: "en",
      video_title: null,
      youtube_video_id: "aaa",
    });
    expect(r.row.dedup_bucket).toBeGreaterThan(0);
    expect(r.position).toBe(1);
    expect((await month(U)).c).toBe(1);
  });

  it("calls the same video again within the window a duplicate, at no cost", async () => {
    expect((await save(U, "aaa")).outcome).toBe("duplicate");
    expect((await month(U)).c).toBe(1);
  });

  it("counts what is ahead in the queue when asked", async () => {
    expect(await save(U, "bbb", { pos: true })).toMatchObject({ outcome: "ok", position: 2 });
  });

  it("refuses past the monthly limit, with the limit and plan, inserting nothing", async () => {
    expect(await save(U, "ccc")).toEqual({ outcome: "limited", limit: 2, plan: "free" });
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int n from clips where user_id = $1",
      [U],
    );
    expect(rows[0].n).toBe(2);
  });

  it("lets the credit wallet, then a recurring bonus, cover more", async () => {
    await db.exec("update users set bonus_credits = 1 where id = '" + U + "'");
    expect((await save(U, "ccc")).outcome).toBe("ok");
    expect((await month(U)).b).toBe(0);
    await db.exec("update users set monthly_limit_bonus = 1 where id = '" + U + "'");
    expect((await save(U, "ddd")).outcome).toBe("ok");
  });

  it("uses the user's own plan and summary language", async () => {
    const r = await save(P, "aaa");
    expect(r.outcome).toBe("ok");
    expect(r.row.summary_language).toBe("ko");
  });

  it("puts the month's count back when a concurrent share wins the unique index", async () => {
    // The windowed check passes (the row looks old) but the index refuses the
    // insert (same bucket): what two shares at the same instant look like.
    await db.exec(
      "update clips set created_at = now() - interval '2 hours' where user_id = '" + P + "'",
    );
    const before = (await month(P)).c;
    expect((await save(P, "aaa")).outcome).toBe("duplicate");
    expect((await month(P)).c).toBe(before);
  });

  it("does not let a failed earlier try block a new one", async () => {
    await db.exec("update clips set status = 'failed' where user_id = '" + P + "'");
    expect((await save(P, "aaa")).outcome).toBe("ok");
  });

  it("refuses an unknown user", async () => {
    expect((await save("33333333-3333-3333-3333-333333333333", "zzz")).outcome).toBe("limited");
  });

  it("can be called by the server only", async () => {
    const { rows } = await db.query<{ a: boolean; b: boolean; s: boolean }>(
      "select has_function_privilege('anon', $1, 'execute') a," +
        " has_function_privilege('authenticated', $1, 'execute') b," +
        " has_function_privilege('service_role', $1, 'execute') s",
      [SIGNATURE],
    );
    expect(rows[0]).toEqual({ a: false, b: false, s: true });
  });
});
