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
function PanelFrame({
  children,
  height,
  width = 392,
}: {
  children: React.ReactNode;
  height: number;
  width?: number;
}) {
  return (
    <div
      className="bg-(--color-surface) border-2 border-black rounded-xl overflow-hidden flex flex-col"
      style={{ width, height, boxShadow: "8px 8px 0 0 rgba(0,0,0,1)" }}
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

function Shot3() {
  return (
    <ShotLayout
      headline={
        <>
          One click. <span style={{ color: "#7a3fb0" }}>Full summary.</span>
        </>
      }
      sub="Hit 'Add to Cliphy' on any YouTube video. Your summary is waiting in the side panel in seconds."
      badges={["Works on any video", "~30 second wait", "No tab switching"]}
      panel={
        <PanelFrame height={580}>
          <div className="flex flex-col gap-4 py-1">
            {/* Step 1 */}
            <div className="flex items-start gap-3">
              <span
                className="w-7 h-7 rounded-full border-2 border-black flex items-center justify-center text-xs font-extrabold shrink-0 text-white"
                style={{ background: "#7a3fb0", boxShadow: "2px 2px 0 0 rgba(0,0,0,1)" }}
              >
                1
              </span>
              <div className="flex-1">
                <p className="text-sm font-bold m-0 mb-1.5">Browse YouTube normally</p>
                <div
                  className="rounded-lg border-2 border-black overflow-hidden flex items-center gap-2.5 px-2.5 py-2"
                  style={{ boxShadow: "3px 3px 0 0 rgba(0,0,0,1)" }}
                >
                  <img
                    src={`https://i.ytimg.com/vi/kYfNvmF0Bqw/mqdefault.jpg`}
                    className="rounded w-16 h-10 object-cover shrink-0"
                    alt=""
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold m-0 leading-tight truncate">
                      Machine Learning — Lecture 1
                    </p>
                    <p className="text-xs text-(--color-text-faint) m-0 mt-0.5">
                      Open Course Library
                    </p>
                  </div>
                  <span
                    className="text-xs font-bold px-2.5 py-1.5 rounded-md border-2 border-black text-white shrink-0"
                    style={{ background: "#7a3fb0", boxShadow: "2px 2px 0 0 rgba(0,0,0,1)" }}
                  >
                    Add to Cliphy
                  </span>
                </div>
              </div>
            </div>

            {/* Arrow */}
            <div className="flex items-center gap-3 pl-3.5">
              <div className="w-7 flex justify-center">
                <svg width="16" height="24" viewBox="0 0 16 24" fill="none">
                  <path
                    d="M8 0v18M1 13l7 8 7-8"
                    stroke="#7a3fb0"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <p className="text-xs text-(--color-text-faint) font-medium m-0">
                Processing… ~30 seconds
              </p>
            </div>

            {/* Step 2 */}
            <div className="flex items-start gap-3">
              <span
                className="w-7 h-7 rounded-full border-2 border-black flex items-center justify-center text-xs font-extrabold shrink-0 text-white"
                style={{ background: "#7a3fb0", boxShadow: "2px 2px 0 0 rgba(0,0,0,1)" }}
              >
                2
              </span>
              <div className="flex-1">
                <p className="text-sm font-bold m-0 mb-1.5">Open the side panel</p>
                <div
                  className="rounded-lg border-2 border-black p-3"
                  style={{ boxShadow: "3px 3px 0 0 rgba(0,0,0,1)" }}
                >
                  <p className="text-xs font-bold m-0 mb-2">Key Points</p>
                  <ul className="list-none p-0 m-0 space-y-1.5">
                    {[
                      "Supervised learning = labeled examples → predictions",
                      "Train/test split keeps evaluation honest",
                      "Most production ML is still tabular data",
                    ].map((pt) => (
                      <li
                        key={pt}
                        className="flex items-start gap-2 text-xs text-(--color-text-body)"
                      >
                        <span className="text-(--color-text-faint) shrink-0 mt-px">→</span>
                        {pt}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {/* Arrow */}
            <div className="flex items-center gap-3 pl-3.5">
              <div className="w-7 flex justify-center">
                <svg width="16" height="24" viewBox="0 0 16 24" fill="none">
                  <path
                    d="M8 0v18M1 13l7 8 7-8"
                    stroke="#7a3fb0"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <p className="text-xs text-(--color-text-faint) font-medium m-0">
                Jump to any moment
              </p>
            </div>

            {/* Step 3 */}
            <div className="flex items-start gap-3">
              <span
                className="w-7 h-7 rounded-full border-2 border-black flex items-center justify-center text-xs font-extrabold shrink-0 text-white"
                style={{ background: "#22c55e", boxShadow: "2px 2px 0 0 rgba(0,0,0,1)" }}
              >
                ✓
              </span>
              <div className="flex-1">
                <p className="text-sm font-bold m-0 mb-1.5">Skip to what matters</p>
                <div
                  className="rounded-lg border-2 border-black p-3 space-y-1"
                  style={{ boxShadow: "3px 3px 0 0 rgba(0,0,0,1)" }}
                >
                  {[
                    "9:30 — What is machine learning?",
                    "38:40 — Regression and classification",
                    "58:05 — Train/test splits and overfitting",
                  ].map((ts) => (
                    <p key={ts} className="text-xs font-mono text-(--color-text-secondary) m-0">
                      {ts}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </PanelFrame>
      }
    />
  );
}

function LargeTileScene() {
  return (
    <div
      className="relative flex flex-col items-center justify-center gap-6 overflow-hidden"
      style={{
        width: 920,
        height: 680,
        background: "linear-gradient(135deg, #7a3fb0 0%, #4a1d7a 100%)",
        pointerEvents: "none",
      }}
    >
      {/* watermark */}
      <div className="absolute -bottom-20 -right-20 opacity-[0.08]">
        <Logo size={480} />
      </div>

      {/* logo card */}
      <div
        className="bg-white border-2 border-black rounded-2xl flex items-center gap-4 px-8 py-5"
        style={{ boxShadow: "6px 6px 0 0 rgba(0,0,0,1)" }}
      >
        <Logo size={68} />
        <span
          className="font-extrabold text-(--color-text)"
          style={{ fontSize: 56, letterSpacing: "-0.02em" }}
        >
          Cliphy
        </span>
      </div>

      <p className="text-white font-bold m-0 text-center" style={{ fontSize: 26 }}>
        YouTube videos, summarized.
      </p>

      {/* feature pills */}
      <div className="flex gap-3 flex-wrap justify-center px-16">
        {["AI key points", "Clickable timestamps", "Queue system", "Side panel"].map((f) => (
          <span
            key={f}
            className="bg-white/15 border-2 border-white/40 text-white rounded-full px-5 py-2 font-bold"
            style={{ fontSize: 15 }}
          >
            {f}
          </span>
        ))}
      </div>
    </div>
  );
}

function MarqueeScene() {
  return (
    <div
      className="relative flex items-center overflow-hidden"
      style={{
        width: 1400,
        height: 560,
        background: "linear-gradient(135deg, #f5f0fa 0%, #ede0f8 50%, #d5b8f0 100%)",
        pointerEvents: "none",
      }}
    >
      {/* watermark */}
      <div
        className="absolute -bottom-28 -left-24 opacity-[0.06]"
        style={{ transform: "rotate(-12deg)" }}
      >
        <Logo size={500} />
      </div>

      {/* left copy */}
      <div className="flex-1 pl-20 pr-8">
        <div className="flex items-center gap-3 mb-6">
          <Logo size={48} />
          <span className="text-3xl font-extrabold tracking-tight text-(--color-text)">Cliphy</span>
        </div>
        <h1
          className="font-extrabold text-(--color-text) m-0 mb-5"
          style={{ fontSize: 52, lineHeight: 1.08, letterSpacing: "-0.02em", maxWidth: 500 }}
        >
          Stop watching. Start knowing.
        </h1>
        <p
          className="text-(--color-text-secondary) font-bold m-0 mb-8"
          style={{ fontSize: 20, maxWidth: 460 }}
        >
          AI summaries, key points, and clickable timestamps — right next to any YouTube video.
        </p>
        <div className="flex gap-3 flex-wrap">
          {["Free to start", "Chrome extension", "30-second summaries", "No tab switching"].map(
            (b) => (
              <span
                key={b}
                className="bg-white border-2 border-black rounded-full px-4 py-1.5 text-sm font-bold"
                style={{ boxShadow: "3px 3px 0 0 rgba(0,0,0,1)" }}
              >
                {b}
              </span>
            ),
          )}
        </div>
      </div>

      {/* right panel */}
      <div className="pr-16 shrink-0">
        <PanelFrame height={480} width={340}>
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
      </div>
    </div>
  );
}

// ── Web dashboard replica ────────────────────────────────────────────────────

const webDemoCards = [
  {
    videoId: "kYfNvmF0Bqw",
    title: "Machine Learning — Lecture 1: Supervised Learning",
    channel: "Open Course Library",
    duration: "1h 15m",
    status: "completed" as const,
    tags: ["lectures", "ml"],
  },
  {
    videoId: "PHe0bXAIuk0",
    title: "How to Build a Financial Model from Scratch",
    channel: "Finance Lab",
    duration: "31m",
    status: "completed" as const,
    tags: ["finance", "business"],
  },
  {
    videoId: "arj7oStGLkU",
    title: "Negotiation Fundamentals: 7 Tactics That Actually Work",
    channel: "The Leadership Lab",
    duration: "18m",
    status: "completed" as const,
    tags: ["business"],
  },
  {
    videoId: "ZK3O402wf1c",
    title: "Linear Algebra — Exam Review: Eigenvalues & Eigenvectors",
    channel: "Campus Lectures",
    duration: "49m",
    status: "processing" as const,
    tags: [],
  },
];

function WebCard({ videoId, title, channel, duration, status, tags }: (typeof webDemoCards)[0]) {
  return (
    <div
      style={{
        border: "2px solid black",
        borderRadius: 8,
        padding: "10px 12px",
        display: "flex",
        gap: 10,
        background: "white",
        boxShadow: "3px 3px 0 0 rgba(0,0,0,1)",
      }}
    >
      <div style={{ position: "relative", flexShrink: 0 }}>
        <img
          src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`}
          style={{
            width: 96,
            height: 56,
            objectFit: "cover",
            borderRadius: 4,
            border: "2px solid black",
            display: "block",
          }}
          alt=""
        />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            fontSize: 12,
            fontWeight: 700,
            margin: "0 0 3px",
            lineHeight: 1.3,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 1,
            WebkitBoxOrient: "vertical",
          }}
        >
          {title}
        </p>
        <p style={{ fontSize: 10, color: "#9ca3af", margin: "0 0 5px" }}>
          {channel} · {duration}
        </p>
        {status !== "completed" && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "1px 8px",
              borderRadius: 999,
              border: "2px solid",
              borderColor: status === "processing" ? "#c4b5fd" : "#d1d5db",
              background: status === "processing" ? "#ede0f8" : "#f9fafb",
              color: status === "processing" ? "#7a3fb0" : "#6b7280",
            }}
          >
            {status === "processing" ? "Generating..." : "Queued"}
          </span>
        )}
        {tags.length > 0 && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {tags.map((t) => (
              <span
                key={t}
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  padding: "1px 6px",
                  borderRadius: 999,
                  background: "#f3f4f6",
                  border: "1px solid #e5e7eb",
                  color: "#6b7280",
                }}
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function WebDashboardScene() {
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
      <div
        className="absolute -bottom-24 -left-20 opacity-[0.07]"
        style={{ transform: "rotate(-12deg)" }}
      >
        <Logo size={420} />
      </div>

      {/* Left copy */}
      <div className="flex-1 pl-20 pr-10 relative">
        <div className="flex items-center gap-3 mb-7">
          <Logo size={44} />
          <span className="text-3xl font-extrabold tracking-tight text-(--color-text)">Cliphy</span>
        </div>
        <h1
          className="font-extrabold text-(--color-text) m-0"
          style={{ fontSize: 52, lineHeight: 1.1, letterSpacing: "-0.02em", maxWidth: 460 }}
        >
          All your summaries, <span style={{ color: "#7a3fb0" }}>organized.</span>
        </h1>
        <p
          className="text-(--color-text-secondary) font-bold mt-6 mb-0"
          style={{ fontSize: 20, maxWidth: 420 }}
        >
          Search, filter by tag, and browse every video you've ever summarized — in one place.
        </p>
        <div className="flex gap-2.5 mt-8 flex-wrap">
          {["Your Cliphub", "Tag filters", "AI auto-tagging", "Bulk actions"].map((b) => (
            <span
              key={b}
              className="bg-white border-2 border-black rounded-full px-4 py-1.5 text-sm font-bold"
              style={{ boxShadow: "3px 3px 0 0 rgba(0,0,0,1)" }}
            >
              {b}
            </span>
          ))}
        </div>
      </div>

      {/* Right: browser window */}
      <div className="pr-14 relative">
        <div
          className="rounded-xl border-2 border-black overflow-hidden"
          style={{
            width: 550,
            height: 720,
            boxShadow: "8px 8px 0 0 rgba(0,0,0,1)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Browser chrome */}
          <div
            style={{
              height: 44,
              background: "#f5f5f5",
              borderBottom: "2px solid black",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "0 14px",
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", gap: 6 }}>
              {(["#ff5f57", "#febc2e", "#28c840"] as const).map((c) => (
                <div
                  key={c}
                  style={{
                    width: 11,
                    height: 11,
                    borderRadius: "50%",
                    background: c,
                    border: "1px solid rgba(0,0,0,0.15)",
                  }}
                />
              ))}
            </div>
            <div
              style={{
                flex: 1,
                maxWidth: 280,
                margin: "0 auto",
                background: "white",
                borderRadius: 20,
                padding: "4px 14px",
                fontSize: 12,
                color: "#555",
                border: "1px solid #ddd",
              }}
            >
              cliphy.app
            </div>
          </div>

          {/* Dashboard content */}
          <div
            style={{
              flex: 1,
              overflow: "hidden",
              background: "white",
              padding: "16px 20px",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Nav */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 16,
                flexShrink: 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Logo size={20} />
                <span style={{ fontWeight: 800, fontSize: 15 }}>Cliphy</span>
              </div>
              <span
                style={{
                  fontSize: 11,
                  color: "#7a3fb0",
                  fontWeight: 700,
                  background: "#ede0f8",
                  padding: "2px 8px",
                  borderRadius: 999,
                  border: "1px solid #c4b5fd",
                }}
              >
                Pro
              </span>
            </div>

            {/* Header + tag pills */}
            <div style={{ marginBottom: 12, flexShrink: 0 }}>
              <h1 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 8px" }}>Your Cliphub</h1>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["lectures", "ml", "finance", "business"].map((tag) => (
                  <span
                    key={tag}
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: 999,
                      border: "2px solid black",
                      background: "white",
                      boxShadow: "2px 2px 0 0 rgba(0,0,0,1)",
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* Search / sort toolbar */}
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexShrink: 0 }}>
              <div
                style={{
                  flex: 1,
                  padding: "6px 12px",
                  borderRadius: 999,
                  border: "2px solid black",
                  fontSize: 12,
                  color: "#bbb",
                  background: "white",
                }}
              >
                Search summaries...
              </div>
              <div
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  border: "2px solid black",
                  fontSize: 12,
                  background: "white",
                  fontWeight: 700,
                  color: "#374151",
                }}
              >
                Newest ▾
              </div>
            </div>

            {/* Cards */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, overflow: "hidden" }}>
              {webDemoCards.map((card) => (
                <WebCard key={card.videoId} {...card} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Mobile queue replica ──────────────────────────────────────────────────────

const mobileDemoCards = [
  {
    videoId: "kYfNvmF0Bqw",
    title: "Machine Learning — Lecture 1",
    channel: "Open Course Library",
    status: "completed" as const,
    tags: ["ml", "lectures"],
  },
  {
    videoId: "UF8uR6Z6KLc",
    title: "Reading Financial Statements in 20 Minutes",
    channel: "MBA Essentials",
    status: "processing" as const,
    tags: [],
  },
  {
    videoId: "arj7oStGLkU",
    title: "Negotiation Fundamentals",
    channel: "The Leadership Lab",
    status: "completed" as const,
    tags: ["business"],
  },
  {
    videoId: "ZK3O402wf1c",
    title: "Linear Algebra — Exam Review",
    channel: "Campus Lectures",
    status: "pending" as const,
    tags: [],
  },
];

function MobileCard({ videoId, title, channel, status, tags }: (typeof mobileDemoCards)[0]) {
  const dotColor =
    status === "completed" ? "#4ade80" : status === "processing" ? "#7a3fb0" : "#6b7280";
  return (
    <div
      style={{
        border: "2px solid #505050",
        borderRadius: 8,
        padding: 10,
        display: "flex",
        gap: 8,
        background: "#282828",
        boxShadow: "2px 2px 0 0 rgba(255,255,255,0.06)",
        flexShrink: 0,
      }}
    >
      <div style={{ position: "relative", flexShrink: 0 }}>
        <img
          src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`}
          style={{
            width: 72,
            height: 44,
            objectFit: "cover",
            borderRadius: 5,
            border: "2px solid #505050",
            display: "block",
          }}
          alt=""
        />
        <div
          style={{
            position: "absolute",
            top: -4,
            right: -4,
            width: 12,
            height: 12,
            borderRadius: 6,
            background: dotColor,
            border: "2px solid #282828",
          }}
        />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "white",
            margin: "0 0 2px",
            lineHeight: 1.3,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {title}
        </p>
        <p style={{ fontSize: 9, color: "#9ca3af", margin: 0 }}>{channel}</p>
        {tags.length > 0 && (
          <div style={{ display: "flex", gap: 3, marginTop: 4 }}>
            {tags.map((t) => (
              <span
                key={t}
                style={{
                  fontSize: 8,
                  padding: "1px 5px",
                  borderRadius: 4,
                  background: "#221028",
                  color: "#a78bfa",
                  fontWeight: 700,
                }}
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MobileScene() {
  return (
    <ShotLayout
      headline={
        <>
          Take Cliphy <span style={{ color: "#7a3fb0" }}>everywhere.</span>
        </>
      }
      sub="Your full summary queue, synced across every device. Pick up right where you left off."
      badges={["iOS & Android", "Real-time sync", "Dark mode"]}
      panel={
        <div
          style={{
            width: 256,
            height: 516,
            background: "#1a1a1a",
            borderRadius: 44,
            border: "3px solid #444",
            padding: "50px 10px 26px",
            boxShadow: "8px 8px 0 0 rgba(0,0,0,1)",
            position: "relative",
          }}
        >
          {/* Dynamic island */}
          <div
            style={{
              position: "absolute",
              top: 14,
              left: "50%",
              transform: "translateX(-50%)",
              width: 70,
              height: 20,
              background: "#000",
              borderRadius: 10,
            }}
          />
          {/* Screen */}
          <div
            style={{
              height: "100%",
              borderRadius: 28,
              overflow: "hidden",
              background: "#111827",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Status bar */}
            <div
              style={{
                height: 20,
                background: "#111827",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0 14px",
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: 9, fontWeight: 700, color: "white" }}>9:41</span>
              <span style={{ fontSize: 9, color: "white", letterSpacing: 1 }}>● ● ●</span>
            </div>
            {/* Header */}
            <div style={{ padding: "6px 12px 8px", flexShrink: 0 }}>
              <p style={{ fontSize: 14, fontWeight: 800, color: "white", margin: "0 0 1px" }}>
                Queue
              </p>
              <p style={{ fontSize: 9, color: "#6b7280", margin: 0 }}>
                5 summaries · 12h 40m saved
              </p>
            </div>
            {/* Cards */}
            <div
              style={{
                flex: 1,
                padding: "0 8px",
                display: "flex",
                flexDirection: "column",
                gap: 6,
                overflow: "hidden",
              }}
            >
              {mobileDemoCards.map((card) => (
                <MobileCard key={card.videoId} {...card} />
              ))}
            </div>
            {/* Tab bar */}
            <div
              style={{
                height: 48,
                background: "#1f2937",
                borderTop: "1px solid #374151",
                display: "flex",
                justifyContent: "space-around",
                alignItems: "center",
                flexShrink: 0,
              }}
            >
              {[
                { label: "Queue", active: true, icon: "▤" },
                { label: "Subs", active: false, icon: "⊕" },
                { label: "Settings", active: false, icon: "⚙" },
              ].map((tab) => (
                <div
                  key={tab.label}
                  style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}
                >
                  <span style={{ fontSize: 14, color: tab.active ? "#a78bfa" : "#4b5563" }}>
                    {tab.icon}
                  </span>
                  <span
                    style={{
                      fontSize: 8,
                      color: tab.active ? "#a78bfa" : "#4b5563",
                      fontWeight: tab.active ? 700 : 400,
                    }}
                  >
                    {tab.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      }
    />
  );
}

// ── Mount ───────────────────────────────────────────────────────────────────

const scene = new URLSearchParams(window.location.search).get("scene") ?? "shot1";
const Scene =
  scene === "tile"
    ? TileScene
    : scene === "large-tile"
      ? LargeTileScene
      : scene === "marquee"
        ? MarqueeScene
        : scene === "shot2"
          ? Shot2
          : scene === "shot3"
            ? Shot3
            : scene === "web-dashboard"
              ? WebDashboardScene
              : scene === "mobile"
                ? MobileScene
                : Shot1;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Scene />
  </StrictMode>,
);
