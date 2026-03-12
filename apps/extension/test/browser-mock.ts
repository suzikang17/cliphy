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
