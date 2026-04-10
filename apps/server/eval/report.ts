import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

// --- Types matching Promptfoo JSON output ---

interface PromptfooOutput {
  evalId: string;
  results: {
    timestamp: string;
    prompts: PromptInfo[];
    results: ResultItem[];
    stats: { successes: number; failures: number; errors: number };
  };
}

interface PromptInfo {
  label: string;
  metrics: {
    score: number;
    testPassCount: number;
    testFailCount: number;
    namedScores: Record<string, number>;
    cost: number;
    totalLatencyMs: number;
  };
}

interface ResultItem {
  promptIdx: number;
  testIdx: number;
  testCase: { description: string };
  response: { output: string };
  gradingResult: {
    pass: boolean;
    score: number;
    namedScores: Record<string, number>;
    componentResults: ComponentResult[];
  };
  cost: number;
  latencyMs: number;
}

interface ComponentResult {
  pass: boolean;
  score: number;
  reason: string;
  assertion?: { type: string; metric: string };
}

interface ParsedSummary {
  summary?: string;
  keyPoints?: string[];
  contextSection?: {
    title: string;
    icon: string;
    items: string[];
    groups?: { label: string; items: string[] }[];
  } | null;
  timestamps?: string[];
  actionItems?: string[];
}

// --- Config ---

const METRICS = ["Faithfulness", "Usefulness", "Timestamps", "ContextSection", "Readability"];
const SHORT = {
  Faithfulness: "Faith",
  Usefulness: "Use",
  Timestamps: "TS",
  ContextSection: "Ctx",
  Readability: "Read",
} as Record<string, string>;

// --- Helpers ---

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function scoreColor(s: number) {
  if (s >= 0.8) return "#16a34a";
  if (s >= 0.6) return "#ca8a04";
  return "#dc2626";
}

function scoreBg(s: number) {
  if (s >= 0.8) return "#f0fdf4";
  if (s >= 0.6) return "#fefce8";
  return "#fef2f2";
}

function renderOutput(raw: string): string {
  let parsed: ParsedSummary;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return `<pre class="raw">${esc(raw)}</pre>`;
  }

  const parts: string[] = [];
  if (parsed.summary) {
    parts.push(`<p class="summary">${esc(parsed.summary)}</p>`);
  }
  if (parsed.keyPoints?.length) {
    parts.push(
      `<div class="label">Key Points</div><ul>${parsed.keyPoints.map((k) => `<li>${esc(k)}</li>`).join("")}</ul>`,
    );
  }
  if (parsed.contextSection) {
    const cs = parsed.contextSection;
    if (cs.groups?.length) {
      parts.push(
        `<div class="label">${esc(cs.icon)} ${esc(cs.title)}</div>` +
          cs.groups
            .map(
              (g) =>
                `<div class="label" style="font-size:.65rem;margin-top:.4rem">${esc(g.label)}</div><ul>${g.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`,
            )
            .join(""),
      );
    } else if (cs.items?.length) {
      parts.push(
        `<div class="label">${esc(cs.icon)} ${esc(cs.title)}</div><ul>${cs.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`,
      );
    }
  }
  if (parsed.timestamps?.length) {
    parts.push(
      `<div class="label">Timestamps</div><ul class="ts">${parsed.timestamps.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`,
    );
  }
  if (parsed.actionItems?.length) {
    parts.push(
      `<div class="label">Action Items</div><ul>${parsed.actionItems.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>`,
    );
  }
  return parts.join("");
}

// --- HTML ---

function generateReport(data: PromptfooOutput): string {
  const { evalId, results } = data;
  const { prompts, results: items, stats } = results;
  const ts = new Date(results.timestamp).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  // Group by prompt
  const byPrompt = new Map<number, ResultItem[]>();
  for (const item of items) {
    const list = byPrompt.get(item.promptIdx) ?? [];
    list.push(item);
    byPrompt.set(item.promptIdx, list);
  }

  // Unique test descriptions
  const tests: string[] = [];
  const seen = new Set<number>();
  for (const item of items) {
    if (!seen.has(item.testIdx)) {
      seen.add(item.testIdx);
      tests.push(item.testCase.description);
    }
  }

  // Find winner per metric
  const winner = (metric: string) => {
    if (prompts.length < 2) return -1;
    const scores = prompts.map((p) => p.metrics.namedScores[metric] ?? 0);
    const max = Math.max(...scores);
    const winners = scores.filter((s) => s === max);
    return winners.length === 1 ? scores.indexOf(max) : -1;
  };

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Eval — ${esc(evalId)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;color:#1e293b;padding:2rem;max-width:1400px;margin:0 auto;font-size:14px}
h1{font-size:1.4rem;font-weight:600}
.meta{color:#64748b;font-size:.8rem;margin-top:.3rem;display:flex;gap:1.2rem}

/* Cards */
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:1rem;margin:1.5rem 0}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:.75rem;padding:1.25rem;overflow:hidden}
.card.win{border-color:#22c55e;box-shadow:0 0 0 1px #22c55e}
.card h2{font-size:1rem;font-weight:600;margin-bottom:.5rem;display:flex;align-items:center;gap:.4rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.badge{font-size:.65rem;padding:.1rem .4rem;border-radius:9999px;background:#f0fdf4;color:#16a34a}
.card-stats{display:flex;gap:1rem;font-size:.75rem;color:#64748b;margin-bottom:.6rem;flex-wrap:wrap}
.card-scores{display:flex;gap:.4rem;flex-wrap:wrap}
.card-score{text-align:center;padding:.35rem .5rem;border-radius:.375rem;flex:1;min-width:60px}
.card-score .lbl{font-size:.6rem;color:#64748b;text-transform:uppercase;letter-spacing:.03em;white-space:nowrap}
.card-score .val{font-size:1.05rem;font-weight:600;margin-top:.1rem}

/* Heatmap */
.heatmap{background:#fff;border:1px solid #e2e8f0;border-radius:.75rem;overflow-x:auto;margin-bottom:1.5rem}
table{width:100%;border-collapse:collapse;font-size:.8rem}
th{position:sticky;top:0;background:#f8fafc;padding:.5rem .6rem;text-align:center;font-weight:600;font-size:.65rem;text-transform:uppercase;letter-spacing:.04em;color:#64748b;border-bottom:1px solid #e2e8f0;white-space:nowrap}
th:first-child,td:first-child{text-align:left;padding-left:1rem}
th.grp{background:#f1f5f9;font-size:.7rem;color:#1e293b}
td{padding:.5rem .6rem;text-align:center;border-bottom:1px solid #f1f5f9}
td:first-child{font-weight:500}
td.sc{font-weight:600}
td.sep,th.sep{border-left:2px solid #cbd5e1}
tr.row{cursor:pointer}
tr.row:hover td{background:#f8fafc}
tr.row td:first-child::before{content:"▶ ";font-size:.6rem;color:#94a3b8}
tr.row.expanded td:first-child::before{content:"▼ "}

/* Detail panel */
.det{display:none}
.det.open{display:table-row}
.det td{padding:0;background:#f8fafc;border-bottom:1px solid #e2e8f0}
.det-grid{display:grid;gap:1rem;padding:1rem}
.det-col{background:#fff;border:1px solid #e2e8f0;border-radius:.5rem;padding:1rem}
.det-col h3{font-size:.85rem;font-weight:600;margin-bottom:.6rem;padding-bottom:.3rem;border-bottom:1px solid #e2e8f0;color:#1e293b}
.det-col .summary{font-size:.8rem;line-height:1.6;margin-bottom:.6rem}
.det-col .label{font-size:.7rem;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:.03em;margin:.6rem 0 .2rem}
.det-col ul{font-size:.78rem;margin:0 0 0 1.2rem;line-height:1.5}
.det-col ul.ts{color:#475569}
.det-col .raw{background:#1e293b;color:#e2e8f0;padding:.6rem;border-radius:.4rem;font-size:.7rem;overflow-x:auto;white-space:pre-wrap;word-break:break-word}

/* Judge */
.judge{margin-top:.8rem}
.judge .label{margin-top:.4rem}
.j-item{display:flex;gap:.4rem;align-items:baseline;padding:.3rem 0;border-bottom:1px solid #f1f5f9;font-size:.75rem}
.j-item:last-child{border-bottom:none}
.j-metric{font-weight:600;min-width:5rem}
.j-score{font-weight:600;min-width:2.5rem}
.j-reason{color:#64748b;flex:1}

@media(max-width:768px){body{padding:1rem}.cards{grid-template-columns:1fr}.card-scores{grid-template-columns:repeat(2,1fr)}}
</style></head><body>

<h1>Eval Report</h1>
<div class="meta">
  <span>${esc(evalId)}</span>
  <span>${ts}</span>
  <span>${tests.length} test${tests.length === 1 ? "" : "s"}</span>
  <span>${prompts.length} prompt${prompts.length === 1 ? "" : "s"}</span>
  <span>${stats.successes}/${stats.successes + stats.failures + stats.errors} passed</span>
</div>

<!-- Prompt comparison cards -->
<div class="cards">
${prompts
  .map((p, pi) => {
    const wins = METRICS.filter((m) => winner(m) === pi).length;
    const otherMax = prompts.reduce(
      (mx, _, oi) =>
        oi === pi ? mx : Math.max(mx, METRICS.filter((m) => winner(m) === oi).length),
      0,
    );
    const isWinner = prompts.length >= 2 && wins > otherMax;
    return `<div class="card${isWinner ? " win" : ""}">
  <h2>${esc(p.label)}${isWinner ? ' <span class="badge">Winner</span>' : ""}</h2>
  <div class="card-stats">
    <span>Score: ${p.metrics.score.toFixed(2)}</span>
    <span>Pass: ${p.metrics.testPassCount}/${p.metrics.testPassCount + p.metrics.testFailCount}</span>
    <span>$${p.metrics.cost.toFixed(4)}</span>
    <span>${(p.metrics.totalLatencyMs / 1000).toFixed(1)}s</span>
  </div>
  <div class="card-scores">
${METRICS.map((m) => {
  const s = p.metrics.namedScores[m] ?? 0;
  const w = winner(m) === pi;
  return `    <div class="card-score" style="background:${scoreBg(s)}${w ? ";outline:2px solid " + scoreColor(s) : ""}">
      <div class="lbl">${esc(m)}</div>
      <div class="val" style="color:${scoreColor(s)}">${s.toFixed(2)}</div>
    </div>`;
}).join("\n")}
  </div>
</div>`;
  })
  .join("\n")}
</div>

<!-- Heatmap -->
<div class="heatmap"><table>
<thead>
  <tr>
    <th class="grp" rowspan="2" style="vertical-align:bottom">Test Case</th>
${prompts.map((p, pi) => `    <th class="grp${pi > 0 ? " sep" : ""}" colspan="${METRICS.length + 1}">${esc(p.label)}</th>`).join("\n")}
  </tr>
  <tr>
${prompts
  .map((_, pi) =>
    METRICS.map(
      (m, mi) =>
        `    <th${mi === 0 && pi > 0 ? ' class="sep"' : ""} title="${esc(m)}">${SHORT[m] ?? esc(m)}</th>`,
    )
      .concat(["    <th>Avg</th>"])
      .join("\n"),
  )
  .join("\n")}
  </tr>
</thead>
<tbody>
${tests
  .map((desc, ti) => {
    const id = `d${ti}`;
    const cols = prompts
      .map((_, pi) => {
        const item = (byPrompt.get(pi) ?? []).find((r) => r.testIdx === ti);
        if (!item || !item.gradingResult)
          return METRICS.map((_, mi) => `    <td${mi === 0 && pi > 0 ? ' class="sep"' : ""}>-</td>`)
            .concat(["    <td>-</td>"])
            .join("\n");
        const cells = METRICS.map((m, mi) => {
          const s = item.gradingResult.namedScores[m] ?? 0;
          return `    <td class="sc${mi === 0 && pi > 0 ? " sep" : ""}" style="background:${scoreBg(s)};color:${scoreColor(s)}">${s.toFixed(2)}</td>`;
        });
        const avg = item.gradingResult.score;
        cells.push(
          `    <td class="sc" style="background:${scoreBg(avg)};color:${scoreColor(avg)}">${avg.toFixed(2)}</td>`,
        );
        return cells.join("\n");
      })
      .join("\n");

    const detailCols = prompts
      .map((p, pi) => {
        const item = (byPrompt.get(pi) ?? []).find((r) => r.testIdx === ti);
        if (!item)
          return `<div class="det-col"><h3>${esc(p.label)}</h3><p style="color:#94a3b8">No result</p></div>`;

        const output = renderOutput(item.response.output);
        const judge = item.gradingResult.componentResults
          .filter((cr) => cr.assertion?.metric && METRICS.includes(cr.assertion.metric))
          .map((cr) => {
            const color = scoreColor(cr.score);
            return `<div class="j-item"><span class="j-metric">${esc(cr.assertion!.metric)}</span><span class="j-score" style="color:${color}">${cr.score.toFixed(2)}</span><span class="j-reason">${esc(cr.reason || "")}</span></div>`;
          })
          .join("");

        return `<div class="det-col">
  <h3>${esc(p.label)}</h3>
  ${output}
  <div class="judge"><div class="label">Judge Reasoning</div>${judge}</div>
</div>`;
      })
      .join("\n");

    const totalCols = 1 + prompts.length * (METRICS.length + 1);
    return `  <tr class="row" onclick="this.classList.toggle('expanded');document.getElementById('${id}').classList.toggle('open')">
    <td>${esc(desc)}</td>
${cols}
  </tr>
  <tr class="det" id="${id}">
    <td colspan="${totalCols}">
      <div class="det-grid" style="grid-template-columns:repeat(${prompts.length},1fr)">
${detailCols}
      </div>
    </td>
  </tr>`;
  })
  .join("\n")}
</tbody>
</table></div>

</body></html>`;
}

// --- API ---

export function generateReportFromFile(jsonPath: string): string {
  const raw = readFileSync(jsonPath, "utf8");
  const data: PromptfooOutput = JSON.parse(raw);
  const html = generateReport(data);

  const htmlPath = jsonPath.replace(/\.json$/, ".html");
  mkdirSync(dirname(htmlPath), { recursive: true });
  writeFileSync(htmlPath, html);
  return htmlPath;
}

// --- Index page listing all runs ---

interface RunSummary {
  file: string;
  evalId: string;
  timestamp: string;
  categories: string; // e.g. "explainer ×2, short ×1"
  tests: number;
  passed: number;
  failed: number;
  scores: Record<string, Record<string, number>>; // prompt → metric → score
  cost: number;
}

function loadRunSummary(jsonPath: string): RunSummary | null {
  try {
    const data: PromptfooOutput = JSON.parse(readFileSync(jsonPath, "utf8"));
    const { prompts, stats } = data.results;
    const scores: Record<string, Record<string, number>> = {};
    for (const p of prompts) {
      scores[p.label] = {};
      for (const m of METRICS) {
        scores[p.label][m] = p.metrics.namedScores[m] ?? 0;
      }
    }

    // Extract categories from test descriptions like "[explainer] Title"
    const catCounts = new Map<string, number>();
    const seenTests = new Set<number>();
    for (const item of data.results.results) {
      if (seenTests.has(item.testIdx)) continue;
      seenTests.add(item.testIdx);
      const match = item.testCase.description.match(/^\[(\w+)\]/);
      if (match) catCounts.set(match[1], (catCounts.get(match[1]) ?? 0) + 1);
    }
    const categories = [...catCounts.entries()].map(([cat, n]) => `${cat} ×${n}`).join(", ");

    return {
      file: basename(jsonPath).replace(/\.json$/, ".html"),
      evalId: data.evalId,
      timestamp: data.results.timestamp,
      categories,
      tests: stats.successes + stats.failures + stats.errors,
      passed: stats.successes,
      failed: stats.failures,
      scores,
      cost: prompts.reduce((sum, p) => sum + p.metrics.cost, 0),
    };
  } catch {
    return null;
  }
}

export function generateIndex(resultsDir: string): string {
  const files = readdirSync(resultsDir)
    .filter((f) => f.endsWith(".json") && f !== "latest.json")
    .sort()
    .reverse();

  // Ensure each JSON has a matching HTML report
  for (const f of files) {
    const htmlFile = f.replace(/\.json$/, ".html");
    if (!readdirSync(resultsDir).includes(htmlFile)) {
      try {
        generateReportFromFile(resolve(resultsDir, f));
      } catch {
        // Skip files that aren't valid promptfoo output
      }
    }
  }

  const runs = files
    .map((f) => loadRunSummary(resolve(resultsDir, f)))
    .filter(Boolean) as RunSummary[];

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Eval Runs</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;color:#1e293b;padding:2rem;max-width:1200px;margin:0 auto;font-size:14px}
h1{font-size:1.4rem;font-weight:600;margin-bottom:1.5rem}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:.75rem;overflow:hidden}
th{background:#f8fafc;padding:.6rem .8rem;text-align:left;font-weight:600;font-size:.7rem;text-transform:uppercase;letter-spacing:.04em;color:#64748b;border-bottom:1px solid #e2e8f0}
th.sc{text-align:center}
td{padding:.6rem .8rem;border-bottom:1px solid #f1f5f9;font-size:.8rem}
td.sc{text-align:center;font-weight:600}
tr:hover td{background:#f8fafc}
a{color:#2563eb;text-decoration:none}
a:hover{text-decoration:underline}
.pass{color:#16a34a}.fail{color:#dc2626}
.meta{color:#64748b;font-size:.75rem}
</style></head><body>
<h1>Eval Runs</h1>
${
  runs.length === 0
    ? "<p>No runs yet.</p>"
    : `<table>
<thead><tr>
  <th style="min-width:10rem">Date</th>
  <th>Tests</th>
  <th>Result</th>
  <th>Categories</th>
${METRICS.map((m) => `  <th class="sc" title="${esc(m)}">${SHORT[m] ?? esc(m)}</th>`).join("\n")}
  <th class="sc">Cost</th>
</tr></thead>
<tbody>
${runs
  .map((r) => {
    const date = new Date(r.timestamp).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    // Show scores for the first prompt (or average across prompts)
    const avgScores: Record<string, number> = {};
    for (const m of METRICS) {
      const vals = Object.values(r.scores).map((s) => s[m] ?? 0);
      avgScores[m] = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
    }
    return `<tr>
  <td><a href="${esc(r.file)}">${date}</a></td>
  <td>${r.tests}</td>
  <td><span class="pass">${r.passed}P</span> <span class="fail">${r.failed}F</span></td>
  <td class="meta">${esc(r.categories)}</td>
${METRICS.map((m) => {
  const s = avgScores[m];
  return `  <td class="sc" style="color:${scoreColor(s)}">${s.toFixed(2)}</td>`;
}).join("\n")}
  <td class="sc meta">$${r.cost.toFixed(3)}</td>
</tr>`;
  })
  .join("\n")}
</tbody></table>`
}
</body></html>`;

  const indexPath = resolve(resultsDir, "index.html");
  writeFileSync(indexPath, html);
  return indexPath;
}

// CLI
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const jsonPath = process.argv[2];
  if (!jsonPath) {
    console.error("Usage: tsx apps/server/eval/report.ts <path-to-results.json>");
    process.exit(1);
  }
  const absPath = resolve(jsonPath);
  const htmlPath = generateReportFromFile(absPath);
  const indexPath = generateIndex(dirname(absPath));
  console.log(`Report: ${htmlPath}`);
  console.log(`Index:  ${indexPath}`);
}
