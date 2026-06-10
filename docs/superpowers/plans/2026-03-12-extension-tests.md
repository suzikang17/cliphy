---
title: "Extension Component Tests Implementation Plan"
date: 2026-03-12
---

# Extension Component Tests Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add unit tests for the extension's QueueList component and active tab message filtering before prod launch.

**Architecture:** Install React Testing Library + jsdom for component tests. Mock `browser.*` APIs with a lightweight helper. Test QueueList button states (livestream, too-long, normal, at-limit) and active tab filtering logic.

**Tech Stack:** Vitest (already installed), @testing-library/react, jsdom

---

## Chunk 1: Test Infrastructure Setup

### Task 1: Install test dependencies

**Files:**

- Modify: `apps/extension/package.json`

- [ ] **Step 1: Install dependencies**

```bash
pnpm --filter extension add -D @testing-library/react @testing-library/jest-dom jsdom @testing-library/dom
```

- [ ] **Step 2: Verify install succeeded**

```bash
pnpm --filter extension ls @testing-library/react
```

Expected: shows installed version

### Task 2: Create browser API mock helper

**Files:**

- Create: `apps/extension/test/browser-mock.ts`

The extension uses `browser.tabs.query` and `browser.runtime.onMessage` from WXT. Create a lightweight mock that satisfies the types used in components.

- [ ] **Step 1: Create the mock file**

```typescript
import { vi } from "vitest";

/** Minimal browser API mock for extension tests */
export const browserMock = {
  tabs: {
    query: vi.fn().mockResolvedValue([]),
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
    onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
    sendMessage: vi.fn(),
    create: vi.fn(),
  },
  runtime: {
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    sendMessage: vi.fn(),
    getURL: vi.fn((path: string) => `chrome-extension://fake/${path}`),
  },
  storage: {
    local: { get: vi.fn(), set: vi.fn() },
  },
};

// WXT auto-injects `browser` as a global — mock it
vi.stubGlobal("browser", browserMock);
```

- [ ] **Step 2: Commit**

```bash
git add apps/extension/package.json apps/extension/test/browser-mock.ts pnpm-lock.yaml
git commit -m "add test dependencies and browser mock for extension tests"
```

## Chunk 2: QueueList Component Tests

### Task 3: Write QueueList component tests

**Files:**

- Create: `apps/extension/components/__tests__/QueueList.test.tsx`

Tests cover the `CurrentVideoItem` sub-component rendered by QueueList when a `currentVideo` is provided and no matching summary exists in the queue.

- [ ] **Step 1: Write test — livestream shows disabled button with "Unavailable"**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { epic, feature, layer } from "allure-js-commons";
import type { VideoInfo } from "@cliphy/shared";
import { QueueList } from "../QueueList";
import "../../test/browser-mock";

const baseVideo: VideoInfo = {
  videoId: "abc123",
  title: "Test Video",
  url: "https://www.youtube.com/watch?v=abc123",
  channel: "Test Channel",
  duration: "10:00",
  isLive: false,
};

const noop = () => {};

const defaultProps = {
  summaries: [],
  onAddToQueue: noop,
  isAdding: false,
  addStatus: "idle" as const,
  onViewSummary: noop,
  onOpenSummary: noop,
  onRemove: noop,
  onRetry: noop,
};

describe("QueueList — CurrentVideoItem", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Queue Video Card");
  });

  it("shows disabled 'Unavailable' button for livestreams", () => {
    render(<QueueList {...defaultProps} currentVideo={{ ...baseVideo, isLive: true }} />);
    const btn = screen.getByRole("button", { name: /unavailable/i });
    expect(btn).toBeDisabled();
  });

  it("shows livestream warning text", () => {
    render(<QueueList {...defaultProps} currentVideo={{ ...baseVideo, isLive: true }} />);
    expect(screen.getByText(/livestreams can't be summarized/i)).toBeTruthy();
  });

  it("shows disabled 'Unavailable' button for too-long videos", () => {
    render(<QueueList {...defaultProps} currentVideo={{ ...baseVideo, duration: "5:00:00" }} />);
    const btn = screen.getByRole("button", { name: /unavailable/i });
    expect(btn).toBeDisabled();
  });

  it("shows too-long warning text", () => {
    render(<QueueList {...defaultProps} currentVideo={{ ...baseVideo, duration: "5:00:00" }} />);
    expect(screen.getByText(/too long to summarize/i)).toBeTruthy();
  });

  it("shows enabled 'Summarize Video' button for normal videos", () => {
    render(<QueueList {...defaultProps} currentVideo={baseVideo} />);
    const btn = screen.getByRole("button", { name: /summarize video/i });
    expect(btn).not.toBeDisabled();
  });

  it("shows 'Unavailable' for livestream even if also too long", () => {
    render(
      <QueueList
        {...defaultProps}
        currentVideo={{ ...baseVideo, isLive: true, duration: "5:00:00" }}
      />,
    );
    expect(screen.getByText(/livestreams can't be summarized/i)).toBeTruthy();
    expect(screen.queryByText(/too long to summarize/i)).toBeNull();
  });

  it("shows upgrade button when at limit", () => {
    render(
      <QueueList {...defaultProps} currentVideo={baseVideo} atLimit={true} onUpgrade={noop} />,
    );
    expect(screen.getByRole("button", { name: /unlock with pro/i })).toBeTruthy();
  });

  it("shows 'Adding...' while adding", () => {
    render(<QueueList {...defaultProps} currentVideo={baseVideo} isAdding={true} />);
    expect(screen.getByRole("button", { name: /adding/i })).toBeDisabled();
  });

  it("shows 'Queued' after successful add", () => {
    render(<QueueList {...defaultProps} currentVideo={baseVideo} addStatus="queued" />);
    expect(screen.getByRole("button", { name: /queued/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
pnpm test:unit -- --run apps/extension/components/__tests__/QueueList.test.tsx
```

Expected: 9 passing tests

- [ ] **Step 3: Commit**

```bash
git add apps/extension/components/__tests__/QueueList.test.tsx
git commit -m "add QueueList component tests for livestream, too-long, and button states"
```

## Chunk 3: Active Tab Filtering Tests

### Task 4: Extract tab filter helper and test it

The active tab filtering logic in App.tsx is embedded in event listeners. Extract the predicate into a testable utility, then test it.

**Files:**

- Create: `apps/extension/lib/is-active-tab.ts`
- Modify: `apps/extension/entrypoints/sidepanel/App.tsx`
- Create: `apps/extension/lib/__tests__/is-active-tab.test.ts`

- [ ] **Step 1: Create the utility**

```typescript
/** Check if a tab ID matches the current active tab */
export async function isActiveTab(tabId: number | undefined): Promise<boolean> {
  if (tabId === undefined) return true; // No tab info = trust it (e.g. background script)
  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  return activeTab?.id === tabId;
}
```

- [ ] **Step 2: Wire it into App.tsx**

Replace the inline `browser.tabs.query` calls in both `onMessage` and `onUpdated` with `isActiveTab()`.

In `onMessage`:

```typescript
if (sender.tab?.id !== undefined) {
  const active = await isActiveTab(sender.tab.id);
  if (!active) return;
}
```

In `onUpdated`:

```typescript
const active = await isActiveTab(tabId);
if (!active) return;
```

- [ ] **Step 3: Write the failing tests**

```typescript
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { epic, feature, layer } from "allure-js-commons";
import "../../test/browser-mock";
import { browserMock } from "../../test/browser-mock";
import { isActiveTab } from "../is-active-tab";

describe("isActiveTab", () => {
  beforeEach(() => {
    layer("unit");
    epic("Extension");
    feature("Active Tab Filtering");
    vi.clearAllMocks();
  });

  it("returns true when tabId matches active tab", async () => {
    browserMock.tabs.query.mockResolvedValue([{ id: 42 }]);
    expect(await isActiveTab(42)).toBe(true);
  });

  it("returns false when tabId does not match active tab", async () => {
    browserMock.tabs.query.mockResolvedValue([{ id: 42 }]);
    expect(await isActiveTab(99)).toBe(false);
  });

  it("returns true when tabId is undefined (background script)", async () => {
    expect(await isActiveTab(undefined)).toBe(true);
  });

  it("returns false when no active tab found", async () => {
    browserMock.tabs.query.mockResolvedValue([]);
    expect(await isActiveTab(42)).toBe(false);
  });
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test:unit -- --run apps/extension/lib/__tests__/is-active-tab.test.ts
```

Expected: 4 passing tests

- [ ] **Step 5: Commit**

```bash
git add apps/extension/lib/is-active-tab.ts apps/extension/lib/__tests__/is-active-tab.test.ts apps/extension/entrypoints/sidepanel/App.tsx
git commit -m "extract isActiveTab helper and add tests for tab filtering"
```
