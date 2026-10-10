/**
 * Live Tabs-view organizer smoke test — hits real Jev (and Claude for leftovers).
 *
 * Opt-in: RUN_TABS_SMOKE=1 and TYPESAFE_API_KEY; otherwise skipped so `test:unit` stays offline.
 *
 * Usage:
 *   RUN_TABS_SMOKE=1 pnpm vitest run apps/server/scripts/smoke-test-tab-organizer.test.ts
 */

import { describe, it, expect, beforeEach } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import { organizeTabs } from "../src/services/tab-organizer.js";

const run = process.env.RUN_TABS_SMOKE === "1" && Boolean(process.env.TYPESAFE_API_KEY);
const maybe = run ? it : it.skip;

// Same SaaS hosts for both clients — only page content tells them apart.
const tabs = [
  {
    key: "acme-linear",
    url: "https://linear.app/team/issue/ENG-412",
    title: "ENG-412 Checkout latency regression",
    text: "Falcon checkout service p95 latency regressed after the Acme payments migration. Owner: Acme platform team. Blocking the Falcon Q4 launch.",
  },
  {
    key: "acme-notion",
    url: "https://www.notion.so/Q4-roadmap-3f9a",
    title: "Q4 roadmap",
    text: "Acme Corp Q4 roadmap. Project Falcon milestones, Acme stakeholder review on Nov 3, budget sign-off from Acme finance.",
  },
  {
    key: "nourish-linear",
    url: "https://linear.app/team/issue/NUR-88",
    title: "NUR-88 Meal plan generator copy",
    text: "Nourish meal plan generator: update onboarding copy for the dietitian portal. Nourish client feedback from last sprint review.",
  },
  {
    key: "nourish-notion",
    url: "https://www.notion.so/Content-calendar-77b1",
    title: "Content calendar",
    text: "Nourish content calendar for November: recipes, dietitian spotlight posts, newsletter schedule for Nourish subscribers.",
  },
  {
    key: "google",
    url: "https://www.google.com/search?q=postgres+partial+index",
    title: "postgres partial index - Google Search",
    text: "About 1,230,000 results. Partial Indexes - PostgreSQL documentation. Stack Overflow: when to use partial index…",
  },
  {
    key: "recipe",
    url: "https://cooking.example.com/sundubu-jjigae",
    title: "Sundubu Jjigae (Korean Soft Tofu Stew)",
    text: "Soft tofu stew with gochugaru, clams, and an egg cracked in at the end. Serves 2. Ingredients: silken tofu, anchovy stock…",
  },
];

describe("tab organizer smoke (live)", () => {
  beforeEach(() => {
    layer("integration");
    epic("Tabs view");
    feature("Organizer Smoke");
  });

  maybe(
    "separates two clients on the same hosts by content and flags search results done",
    async () => {
      const t = Date.now();
      const r = await organizeTabs({
        tabs,
        existingTags: ["client:acme", "client:nourish", "cooking"],
        hints: {
          "client:acme": "Acme Corp, project Falcon, payments",
          "client:nourish": "Nourish, meal plans, dietitian portal",
        },
      });
      console.log(`organize (${Date.now() - t}ms):`, JSON.stringify(r, null, 2));

      expect(r.assignments["acme-linear"]).toEqual({ tag: "client:acme" });
      expect(r.assignments["acme-notion"]).toEqual({ tag: "client:acme" });
      expect(r.assignments["nourish-linear"]).toEqual({ tag: "client:nourish" });
      expect(r.assignments["nourish-notion"]).toEqual({ tag: "client:nourish" });
      expect(r.assignments.recipe).toEqual({ tag: "cooking" });
      expect(r.done).toContain("google");
      expect(r.done).not.toContain("acme-notion");
    },
    60_000,
  );
});
