// Runs the Alder House fixture through the real model and checks the reading.
// Costs one model call. Usage:
//   pnpm -C apps/server tsx --env-file=.env.local scripts/coach-interpret-fixture.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { InboundMessage } from "@cliphy/shared";
import { interpretBundle, type InterpretContext } from "../src/services/coach/interpret.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../eval/fixtures/coach");
const fixture = JSON.parse(readFileSync(path.join(dir, "alder-house.json"), "utf8")) as {
  context: InterpretContext;
  messages: InboundMessage[];
  expected: {
    kind: string;
    projectId: string;
    replacesRequestId: string;
    questionPresent: boolean;
    taskKinds: string[];
  };
};

const images = fixture.messages.flatMap((m) =>
  m.attachments.map((a) => ({
    bytes: readFileSync(path.join(dir, a.storagePath)),
    mediaType: a.mediaType,
  })),
);

const result = await interpretBundle(fixture.messages, images, fixture.context);
console.log(JSON.stringify(result, null, 2));

const { expected } = fixture;
const problems: string[] = [];
if (result.kind !== expected.kind) problems.push(`kind is ${result.kind}`);
if (result.projectId !== expected.projectId) problems.push(`projectId is ${result.projectId}`);
if (result.replacesRequestId !== expected.replacesRequestId) {
  problems.push(`replacesRequestId is ${result.replacesRequestId}`);
}
if ((result.question !== null) !== expected.questionPresent) {
  problems.push(`question is ${result.question ? "present" : "missing"}`);
}
const kinds = result.tasks.map((t) => t.kind);
if (JSON.stringify(kinds) !== JSON.stringify(expected.taskKinds)) {
  problems.push(`task kinds are ${kinds.join(",")}`);
}

if (problems.length) {
  console.error(`fixture mismatch: ${problems.join("; ")}`);
  process.exit(1);
}
console.log("fixture ok");
