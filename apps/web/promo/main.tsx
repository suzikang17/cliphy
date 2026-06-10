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
  // Real video IDs so i.ytimg.com serves real thumbnails (blurred via promo.css).
  // Picked for blurred vibe: lecture halls, chalkboards, talks.
  videoId: "kYfNvmF0Bqw",
  videoTitle: "Machine Learning — Lecture 1: Supervised Learning",
  videoChannel: "Open Course Library",
  videoDurationSeconds: 4530,
  status: "completed",
  tags: ["lectures", "ml"],
  createdAt: hoursAgo(2),
  updatedAt: hoursAgo(2),
  summaryJson: {
    summary:
      "First lecture of the series: what machine learning actually is, and why supervised learning dominates real applications. Covers the difference between regression and classification, how a model 'learns' from labeled examples, and the train/test split that keeps you honest. Ends with course logistics and what's expected for problem set 1.",
    keyPoints: [
      "Supervised learning = learning a mapping from labeled examples",
      "Regression predicts continuous values; classification predicts categories",
      "Never evaluate on data the model trained on — that's the whole point of the test set",
      "Most production ML is still supervised learning on tabular data",
    ],
    contextSection: {
      title: "Action Items",
      icon: "→",
      items: [
        "Review the linear regression notes before Thursday",
        "Start problem set 1 — due in two weeks",
        "Skim chapter 2 of the course reader",
      ],
    },
    timestamps: [
      "0:00 — Course logistics and grading",
      "9:30 — What is machine learning?",
      "21:15 — Supervised vs unsupervised learning",
      "38:40 — Regression and classification, with examples",
      "58:05 — Train/test splits and overfitting",
      "1:09:20 — Problem set 1 walkthrough",
    ],
  },
};

const queueSummaries: Summary[] = [
  demoSummary,
  {
    id: "demo-2",
    userId: "demo",
    videoId: "UF8uR6Z6KLc",
    videoTitle: "Reading Financial Statements in 20 Minutes",
    videoChannel: "MBA Essentials",
    videoDurationSeconds: 1245,
    status: "processing",
    tags: [],
    createdAt: hoursAgo(0.05),
    updatedAt: hoursAgo(0.05),
  },
  {
    id: "demo-3",
    userId: "demo",
    videoId: "arj7oStGLkU",
    videoTitle: "Negotiation Fundamentals: 7 Tactics That Actually Work",
    videoChannel: "The Leadership Lab",
    videoDurationSeconds: 1130,
    status: "completed",
    tags: ["business"],
    createdAt: hoursAgo(26),
    updatedAt: hoursAgo(26),
    summaryJson: {
      summary: "Seven research-backed negotiation tactics.",
      keyPoints: ["Anchor first", "Trade, don't concede"],
      timestamps: ["0:00 — Intro"],
    },
  },
  {
    id: "demo-4",
    userId: "demo",
    videoId: "ZK3O402wf1c",
    videoTitle: "Linear Algebra — Exam Review: Eigenvalues & Eigenvectors",
    videoChannel: "Campus Lectures",
    videoDurationSeconds: 2940,
    status: "pending",
    tags: [],
    createdAt: hoursAgo(0.01),
    updatedAt: hoursAgo(0.01),
  },
];

const demoVideo: VideoInfo = {
  videoId: "PHe0bXAIuk0",
  title: "How to Build a Financial Model from Scratch",
  url: "https://www.youtube.com/watch?v=demo",
  channel: "Finance Lab",
  duration: "31:08",
  isLive: false,
};

const demoUsage: UsageInfo = {
  used: 12,
  limit: 100,
  plan: "pro",
  resetAt: new Date(Date.now() + 14 * 86400_000).toISOString(),
  totalTimeSavedSeconds: 45_600,
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
              allTags={["lectures", "ml", "business"]}
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
