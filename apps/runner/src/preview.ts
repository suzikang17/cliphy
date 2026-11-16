import type { Exec } from "./machine.js";
import type { Alive } from "./run.js";

// Cloudflare builds a preview for every branch pushed to a connected repo and
// reports it to GitHub as a deployment. This is the only place that knows
// that: a host that reports differently needs only a different function here.

type Row = Record<string, unknown>;

const POLL_MS = 15_000;

/**
 * The preview address for a branch, from GitHub's list of deployments (newest
 * first) and a way to read one deployment's statuses (newest first). Null
 * until the branch's newest deployment has succeeded.
 */
export async function previewFromDeployments(
  deployments: unknown,
  head: { branch: string; sha: string },
  statuses: (id: number) => Promise<unknown>,
): Promise<string | null> {
  if (!Array.isArray(deployments)) return null;
  // Recorded against the branch name or against its commit, depending on the host.
  const mine = (deployments as Row[]).find(
    (d) => d.ref === head.branch || d.ref === head.sha || d.sha === head.sha,
  );
  if (!mine || typeof mine.id !== "number") return null;
  const list = await statuses(mine.id);
  const latest = Array.isArray(list) ? (list[0] as Row | undefined) : undefined;
  if (latest?.state !== "success") return null;
  const url = latest.environment_url ?? latest.target_url;
  return typeof url === "string" && /^https:\/\/[^\s/]+\S*$/.test(url) ? url : null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait for the branch's preview, asking GitHub every few seconds until `limitMs` has passed. */
export async function findPreview(
  exec: Exec,
  repo: string,
  branch: string,
  limitMs: number,
  alive: Alive,
): Promise<string | null> {
  const api = async (route: string): Promise<unknown> => {
    const result = await exec("gh", ["api", route], { timeoutMs: 30_000 });
    if (result.code !== 0) return null;
    try {
      return JSON.parse(result.stdout) as unknown;
    } catch {
      return null;
    }
  };
  const commit = (await api(`repos/${repo}/commits/${encodeURIComponent(branch)}`)) as Row | null;
  const sha = typeof commit?.sha === "string" ? commit.sha : "";

  const deadline = Date.now() + limitMs;
  let waited = 0;
  while (Date.now() < deadline) {
    const url = await previewFromDeployments(
      await api(`repos/${repo}/deployments?per_page=30`),
      { branch, sha },
      (id) => api(`repos/${repo}/deployments/${id}/statuses?per_page=5`),
    );
    if (url) return url;
    await sleep(POLL_MS);
    waited += POLL_MS;
    // Once a minute, check in; that is also how a Stop is heard.
    if (waited % 60_000 === 0 && !(await alive().catch(() => true))) return null;
  }
  return null;
}
