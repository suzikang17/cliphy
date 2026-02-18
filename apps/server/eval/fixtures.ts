import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "fixtures");

export interface Fixture {
  videoId: string;
  title: string;
  category: string;
  transcript: string;
}

export function loadFixtures(): Fixture[] {
  if (!existsSync(FIXTURES_DIR)) return [];
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(FIXTURES_DIR, f), "utf-8")) as Fixture);
}

export function saveFixture(fixture: Fixture): string {
  if (!existsSync(FIXTURES_DIR)) mkdirSync(FIXTURES_DIR, { recursive: true });
  const filename = `${fixture.videoId}.json`;
  const filepath = join(FIXTURES_DIR, filename);
  writeFileSync(filepath, JSON.stringify(fixture, null, 2) + "\n");
  return filepath;
}
