import { vi } from "vitest";

const listener = () => ({ addListener: vi.fn(), removeListener: vi.fn() });

/** Minimal browser API mock for extension tests */
export const browserMock = {
  tabs: {
    query: vi.fn().mockResolvedValue([]),
    onCreated: listener(),
    onRemoved: listener(),
    onUpdated: listener(),
    onActivated: listener(),
    sendMessage: vi.fn(),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn(),
  },
  windows: {
    update: vi.fn().mockResolvedValue(undefined),
    getLastFocused: vi.fn().mockResolvedValue({ id: 1 }),
  },
  runtime: {
    onMessage: listener(),
    sendMessage: vi.fn(),
    getURL: vi.fn((path: string) => `chrome-extension://fake/${path}`),
  },
  permissions: {
    request: vi.fn().mockResolvedValue(true),
    contains: vi.fn().mockResolvedValue(false),
    onAdded: listener(),
    onRemoved: listener(),
  },
  scripting: {
    executeScript: vi.fn().mockResolvedValue([]),
  },
  commands: {
    onCommand: listener(),
  },
  sidePanel: {
    open: vi.fn().mockResolvedValue(undefined),
  },
  history: {
    search: vi.fn().mockResolvedValue([]),
  },
  storage: {
    local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
    session: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
  },
};

// WXT auto-injects `browser` as a global — mock it
vi.stubGlobal("browser", browserMock);
