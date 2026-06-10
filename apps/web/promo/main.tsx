/**
 * Chrome Web Store promo-asset scenes.
 *
 * Renders the REAL extension components (QueueList, SummaryDetail, UsageBar)
 * with demo data at exact CWS dimensions, for headless screenshot capture:
 *
 *   ?scene=tile  → 440×280  small promo tile
 *   ?scene=shot1 → 1280×800 summary screenshot
 *   ?scene=shot2 → 1280×800 queue screenshot
 */
import type { Summary, UsageInfo } from "@cliphy/shared";
import type { VideoInfo } from "@cliphy/shared";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Logo } from "../../extension/components/Logo";
import { QueueList } from "../../extension/components/QueueList";
import { SummaryDetail } from "../../extension/components/SummaryDetail";
import { UsageBar } from "../../extension/components/UsageBar";
import "./promo.css";

const noop = () => {};
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

// ── Demo data ───────────────────────────────────────────────────────────────

const demoSummary: Summary = {
  id: "demo-1",
  userId: "demo",
  // Real video IDs so i.ytimg.com serves real thumbnails (blurred via promo.css)
  videoId: "LXb3EKWsInQ",
  videoTitle: "The Science of Learning Faster",
  videoChannel: "Beyond Curious",
  videoDurationSeconds: 1284,
  status: "completed",
  tags: ["learning", "productivity"],
  createdAt: hoursAgo(2),
  updatedAt: hoursAgo(2),
  summaryJson: {
    summary:
      "Most study advice optimizes for feeling productive, not for retention. This video walks through what cognitive science actually says: spaced repetition beats cramming, testing yourself beats re-reading, and interleaving topics beats blocked practice — then shows how to combine all three into a 30-minute daily system.",
    keyPoints: [
      "Re-reading creates an illusion of mastery — recognition isn't recall",
      "Spacing reviews 1, 3, and 7 days out doubles long-term retention",
      "Self-testing is the single highest-leverage study technique",
      "Interleaving related topics feels harder but transfers better",
    ],
    contextSection: {
      title: "Action Items",
      icon: "→",
      items: [
        "Replace tonight's re-read with a 10-question self-quiz",
        "Set up spaced reviews: tomorrow, Thursday, next Monday",
        "Mix two related topics in each study block",
      ],
    },
    timestamps: [
      "0:00 — Why cramming fails",
      "3:12 — Spaced repetition, explained",
      "8:45 — The testing effect",
      "14:30 — Building a 30-minute system",
      "19:02 — Mistakes to avoid",
    ],
  },
};

const queueSummaries: Summary[] = [
  demoSummary,
  {
    id: "demo-2",
    userId: "demo",
    videoId: "M7lc1UVf-VE",
    videoTitle: "Inside the M4 Chip — Explained in 14 Minutes",
    videoChannel: "Silicon Decoded",
    videoDurationSeconds: 845,
    status: "processing",
    tags: [],
    createdAt: hoursAgo(0.05),
    updatedAt: hoursAgo(0.05),
  },
  {
    id: "demo-3",
    userId: "demo",
    videoId: "jNQXAC9IVRw",
    videoTitle: "10 Python Tricks I Wish I Knew Earlier",
    videoChannel: "DevSimplified",
    videoDurationSeconds: 598,
    status: "completed",
    tags: ["coding"],
    createdAt: hoursAgo(26),
    updatedAt: hoursAgo(26),
    summaryJson: {
      summary: "Ten practical Python idioms.",
      keyPoints: ["Use enumerate", "Prefer pathlib"],
      timestamps: ["0:00 — Intro"],
    },
  },
  {
    id: "demo-4",
    userId: "demo",
    videoId: "9bZkp7q19f0",
    videoTitle: "The History of the Internet in 12 Minutes",
    videoChannel: "Timeline",
    videoDurationSeconds: 731,
    status: "pending",
    tags: [],
    createdAt: hoursAgo(0.01),
    updatedAt: hoursAgo(0.01),
  },
];

const demoVideo: VideoInfo = {
  videoId: "aqz-KE-bpKQ",
  title: "Why Top Athletes Train Less Than You Think",
  url: "https://www.youtube.com/watch?v=demo",
  channel: "Peak Performance Lab",
  duration: "16:42",
  isLive: false,
};

const demoUsage: UsageInfo = {
  used: 12,
  limit: 100,
  plan: "pro",
  resetAt: new Date(Date.now() + 14 * 86400_000).toISOString(),
  totalTimeSavedSeconds: 19_260,
  bonusCredits: 0,
};

// ── Scene chrome ────────────────────────────────────────────────────────────

/** Side-panel window frame, styled like the real extension surface. */
function PanelFrame({ children, height }: { children: React.ReactNode; height: number }) {
  return (
    <div
      className="bg-(--color-surface) border-2 border-black rounded-xl overflow-hidden flex flex-col"
      style={{ width: 392, height, boxShadow: "8px 8px 0 0 rgba(0,0,0,1)" }}
    >
      <div className="flex items-center gap-2 px-4 py-2.5 border-b-2 border-black shrink-0 bg-(--color-surface)">
        <Logo size={22} />
        <span className="font-bold text-base tracking-tight">Cliphy</span>
        <span className="ml-auto text-xs font-bold text-(--color-text-faint)">Side panel</span>
      </div>
      <div className="flex-1 overflow-hidden px-3 py-3 flex flex-col gap-3">{children}</div>
    </div>
  );
}

function ShotLayout({
  headline,
  sub,
  badges,
  panel,
}: {
  headline: React.ReactNode;
  sub: string;
  badges?: string[];
  panel: React.ReactNode;
}) {
  return (
    <div
      className="relative flex items-center"
      style={{
        width: 1280,
        height: 800,
        background: "linear-gradient(135deg, #f5f0fa 0%, #ede0f8 45%, #d5b8f0 100%)",
        pointerEvents: "none",
      }}
    >
      {/* watermark */}
      <div
        className="absolute -bottom-24 -left-20 opacity-[0.07]"
        style={{ transform: "rotate(-12deg)" }}
      >
        <Logo size={420} />
      </div>
      <div className="flex-1 pl-20 pr-10 relative">
        <div className="flex items-center gap-3 mb-7">
          <Logo size={44} />
          <span className="text-3xl font-extrabold tracking-tight text-(--color-text)">Cliphy</span>
        </div>
        <h1
          className="font-extrabold text-(--color-text) m-0"
          style={{ fontSize: 58, lineHeight: 1.08, letterSpacing: "-0.02em", maxWidth: 560 }}
        >
          {headline}
        </h1>
        <p
          className="text-(--color-text-secondary) font-bold mt-6 mb-0"
          style={{ fontSize: 22, maxWidth: 520 }}
        >
          {sub}
        </p>
        {badges && (
          <div className="flex gap-2.5 mt-8 flex-wrap">
            {badges.map((b) => (
              <span
                key={b}
                className="bg-white border-2 border-black rounded-full px-4 py-1.5 text-sm font-bold"
                style={{ boxShadow: "3px 3px 0 0 rgba(0,0,0,1)" }}
              >
                {b}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="pr-16 relative">{panel}</div>
    </div>
  );
}

// ── Scenes ──────────────────────────────────────────────────────────────────

function TileScene() {
  return (
    <div
      className="flex flex-col items-center justify-center gap-4"
      style={{
        width: 440,
        height: 280,
        background: "linear-gradient(135deg, #7a3fb0 0%, #5e2e8e 100%)",
        pointerEvents: "none",
      }}
    >
      <div
        className="bg-white border-2 border-black rounded-2xl flex items-center gap-3 px-6 py-4"
        style={{ boxShadow: "5px 5px 0 0 rgba(0,0,0,1)" }}
      >
        <Logo size={52} />
        <span
          className="font-extrabold text-(--color-text)"
          style={{ fontSize: 40, letterSpacing: "-0.02em" }}
        >
          Cliphy
        </span>
      </div>
      <p className="text-white font-bold m-0" style={{ fontSize: 21 }}>
        YouTube videos, summarized.
      </p>
    </div>
  );
}

function Shot1() {
  return (
    <ShotLayout
      headline={
        <>
          Read the video <span style={{ color: "#7a3fb0" }}>first.</span>
        </>
      }
      sub="AI summaries with key points, action items, and clickable timestamps — right next to the video."
      panel={
        <PanelFrame height={720}>
          <div className="overflow-hidden">
            <SummaryDetail
              summary={demoSummary}
              allTags={["learning", "productivity", "coding"]}
              onSeek={noop}
            />
          </div>
        </PanelFrame>
      }
    />
  );
}

function Shot2() {
  return (
    <ShotLayout
      headline={
        <>
          Queue now. <span style={{ color: "#7a3fb0" }}>Skim later.</span>
        </>
      }
      sub="Add videos as you browse — summaries land in your queue in seconds."
      badges={['"Add to Cliphy" on YouTube', "Right-click any video", "Side panel"]}
      panel={
        <PanelFrame height={690}>
          <div className="flex-1 overflow-hidden">
            <QueueList
              summaries={queueSummaries}
              currentVideo={demoVideo}
              onAddToQueue={noop}
              isAdding={false}
              addStatus="idle"
              onViewSummary={noop}
              onOpenSummary={noop}
              onRemove={noop}
              onRetry={noop}
            />
          </div>
          <div className="shrink-0">
            <UsageBar usage={demoUsage} />
          </div>
        </PanelFrame>
      }
    />
  );
}

// ── Mount ───────────────────────────────────────────────────────────────────

const scene = new URLSearchParams(window.location.search).get("scene") ?? "shot1";
const Scene = scene === "tile" ? TileScene : scene === "shot2" ? Shot2 : Shot1;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Scene />
  </StrictMode>,
);
