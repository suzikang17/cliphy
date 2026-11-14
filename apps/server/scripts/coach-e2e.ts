// End-to-end proof for the coach server core, against a running API.
//
// Needs: the server and Inngest dev running, migration 038 applied, an account
// with coach_enabled = true, and an API key for it. Costs two model calls and
// takes several minutes (bundles wait 3 minutes of quiet before being read).
//
//   COACH_E2E_URL=http://localhost:3001 COACH_E2E_KEY=<api key> \
//     pnpm -C apps/server tsx --env-file=.env.local scripts/coach-e2e.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CoachRequest, CoachTask, Person, Project } from "@cliphy/shared";
import type { HistoryEntry } from "../src/services/coach/history.js";

const base = process.env.COACH_E2E_URL;
const key = process.env.COACH_E2E_KEY;
if (!base || !key) {
  console.error("Set COACH_E2E_URL and COACH_E2E_KEY");
  process.exit(2);
}

const fixtureDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../eval/fixtures/coach",
);
const run = Date.now().toString(36);
const TIMEOUT_MS = 6 * 60_000;

async function api<T>(method: string, route: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}/coach${route}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok && res.status !== 409) throw new Error(`${method} ${route} → ${res.status} ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}

function fail(message: string): never {
  console.error(`coach e2e FAILED: ${message}`);
  process.exit(1);
}

async function waitFor<T>(what: string, check: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const found = await check();
    if (found !== undefined) return found;
    await new Promise((r) => setTimeout(r, 10_000));
  }
  return fail(`timed out waiting for ${what}`);
}

async function upload(file: string): Promise<string> {
  const { path: storagePath, signedUrl } = await api<{ path: string; signedUrl: string }>(
    "POST",
    "/intake/upload-url",
    { mediaType: "image/png" },
  );
  const put = await fetch(signedUrl, {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: readFileSync(path.join(fixtureDir, file)),
  });
  if (!put.ok) fail(`upload of ${file} → ${put.status}`);
  return storagePath;
}

// 1. A person who is both client and collaborator, and their project.
const { person } = await api<{ person: Person }>("POST", "/people", {
  name: `Maren (e2e ${run})`,
  role: "both",
});
await api("POST", "/projects", { name: `Alder House ${run}`, personIds: [person.id] });
const { projects } = await api<{ projects: Project[] }>("GET", "/projects");
const project = projects.find((p) => p.name === `Alder House ${run}`) ?? fail("project missing");
console.log(`person ${person.id}, project ${project.id}`);

// 2. An old request, read from the thread's past: it must arrive as history.
await api("POST", "/intake/messages", {
  personId: person.id,
  channel: "imessage",
  historical: true,
  messages: [
    {
      externalId: `e2e-${run}-old`,
      direction: "in",
      text: `Here is the page 2 text for Alder House ${run}: Alder House was designed around a warm, minimal concept.`,
      sentAt: "2022-03-01T10:00:00Z",
    },
  ],
});
const old = await waitFor("the historical request", async () => {
  const { requests } = await api<{ requests: CoachRequest[] }>("GET", "/requests?status=closed");
  return requests.find((r) => r.personId === person.id);
});
if (!old.historical) fail("old request is not marked historical");
if (old.proposedTasks.length) fail("historical request has proposed tasks");
console.log(`historical request ${old.id}: ${old.understood}`);

// 3. Today's bundle: two screenshots, one loose sentence, the replacement copy.
const [page1, page2] = [
  await upload("alder-house-page-1.png"),
  await upload("alder-house-page-2.png"),
];
const now = Date.now();
const at = (offsetMs: number) => new Date(now + offsetMs).toISOString();
const sent = await api<{ stored: number; bundleIds: string[] }>("POST", "/intake/messages", {
  personId: person.id,
  channel: "imessage",
  messages: [
    {
      externalId: `e2e-${run}-1`,
      direction: "in",
      sentAt: at(0),
      attachments: [{ storagePath: page1, mediaType: "image/png" }],
    },
    {
      externalId: `e2e-${run}-2`,
      direction: "in",
      sentAt: at(5_000),
      attachments: [{ storagePath: page2, mediaType: "image/png" }],
    },
    {
      externalId: `e2e-${run}-3`,
      direction: "in",
      sentAt: at(40_000),
      text: "I like the writing on page 1 more than page 2",
    },
    {
      externalId: `e2e-${run}-4`,
      direction: "in",
      sentAt: at(70_000),
      text: `Set above the valley, Alder House ${run} takes a quieter approach to family living.`,
    },
  ],
});
if (sent.stored !== 4 || sent.bundleIds.length !== 1) {
  fail(`expected 4 messages in 1 bundle, got ${JSON.stringify(sent)}`);
}

const request = await waitFor("the new request", async () => {
  const { requests } = await api<{ requests: CoachRequest[] }>("GET", "/requests?status=new");
  return requests.find((r) => r.bundleId === sent.bundleIds[0]);
});
console.log("request:", JSON.stringify(request, null, 2));
if (request.projectId !== project.id) fail(`request filed under ${request.projectId}`);
if (request.proposedReplacesId !== old.id) {
  fail(`expected it to replace ${old.id}, got ${request.proposedReplacesId}`);
}

// 4. "Looks right", answering the question: the chain is created once.
const confirmed = await api<{ request: CoachRequest; tasks: CoachTask[] }>(
  "POST",
  `/requests/${request.id}/confirm`,
  { answer: "Only the words" },
);
console.log("tasks:", JSON.stringify(confirmed.tasks, null, 2));
const kinds = confirmed.tasks.map((t) => t.kind).join(",");
if (kinds !== "do,tell") fail(`expected do,tell after answering, got ${kinds}`);
if (confirmed.tasks[0].blocked) fail("the do task is blocked");
if (!confirmed.tasks[1].blocked) fail("the tell task is not blocked");

const again = await api<{ tasks: CoachTask[] }>("POST", `/requests/${request.id}/confirm`, {});
if (again.tasks.length !== confirmed.tasks.length) fail("a second confirm created more tasks");

// 5. The trail of the work: the old copy sits under the new request.
const { entries } = await api<{ entries: HistoryEntry[] }>(
  "GET",
  `/projects/${project.id}/history`,
);
console.log("history:", JSON.stringify(entries, null, 2));
if (entries[0]?.request.id !== request.id) fail("newest history entry is not the new request");
if (!entries[0].replaced.some((r) => r.id === old.id)) {
  fail("the 2022 request is not shown under the request that replaced it");
}

console.log("coach e2e ok");
