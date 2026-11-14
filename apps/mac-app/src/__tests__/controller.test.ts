import { describe, expect, it } from "vitest";
import { ApiError } from "../../../mac-helper/src/sync.js";
import type { HelperConfig } from "../../../mac-helper/src/store.js";
import { Controller, type AppState, type ControllerDeps } from "../controller.js";

const person = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  name: "Maren",
  handles: ["+15550100"],
  captureThread: true,
  historyWindow: "new" as const,
  historyDays: null,
  ...over,
});

function setup(over: Partial<ControllerDeps> = {}, config: HelperConfig | null = null) {
  const seen: AppState[] = [];
  const box = { config, synced: 0, cleared: 0, readable: true };
  const deps: ControllerDeps = {
    apiUrl: "https://api.example.com",
    loadConfig: () => box.config,
    saveConfig: (c) => {
      box.config = c;
    },
    clearConfig: () => {
      box.config = null;
      box.cleared++;
    },
    pair: async (_url, show) => {
      show("ABCD-EFGH");
      return { apiKey: "cliphy_sk_x", account: "maren@example.com" };
    },
    canReadMessages: () => box.readable,
    people: async () => [person()],
    sync: async () => {
      box.synced++;
      return { uploaded: 2, skippedAttachments: 0, people: 1, offline: false };
    },
    setCapture: async () => {},
    recentThreads: () => [],
    addPerson: async () => {},
    now: () => new Date("2026-11-14T18:00:00Z"),
    onChange: (s) => seen.push(structuredClone(s)),
    ...over,
  };
  return { c: new Controller(deps), seen, box };
}

const paired: HelperConfig = {
  apiUrl: "https://api.example.com",
  apiKey: "cliphy_sk_x",
  account: "maren@example.com",
};

describe("mac app controller", () => {
  it("with no saved key, shows a code and saves the key once the phone confirms", async () => {
    const { c, seen, box } = setup();
    await c.tick();
    expect(seen.some((s) => s.step === "pair" && s.code === "ABCD-EFGH")).toBe(true);
    expect(box.config).toEqual(paired);
    expect(c.state.account).toBe("maren@example.com");
    expect(c.state.code).toBeNull();
    expect(c.state.step).not.toBe("pair");
  });

  it("starts over with a new code when one expires", async () => {
    let n = 0;
    const { c, box } = setup({
      pair: async (_url, show) => {
        n++;
        show(n === 1 ? "AAAA-AAAA" : "BBBB-BBBB");
        if (n === 1) throw new Error("The code expired. Run pair again.");
        return { apiKey: "k", account: null };
      },
    });
    await c.tick();
    expect(c.state.step).toBe("pair");
    expect(c.state.code).toBeNull();
    expect(box.config).toBeNull();
    await c.tick();
    expect(box.config?.apiKey).toBe("k");
  });

  it("asks for access to Messages before reading anything", async () => {
    const { c, box } = setup({}, paired);
    box.readable = false;
    await c.tick();
    expect(c.state.step).toBe("access");
    expect(box.synced).toBe(0);
  });

  it("uploads once Messages is readable, and lists the people", async () => {
    const { c, box } = setup({}, paired);
    await c.tick();
    expect(c.state.step).toBe("ready");
    expect(box.synced).toBe(1);
    expect(c.state.lastSyncAt).toBe("2026-11-14T18:00:00.000Z");
    expect(c.state.lastUploaded).toBe(2);
    expect(c.state.people).toEqual([{ id: "p1", name: "Maren", capture: true, hasHandle: true }]);
    expect(c.state.account).toBe("maren@example.com");
  });

  it("goes back to the code when the key no longer works", async () => {
    const { c, box } = setup(
      {
        people: async () => {
          throw new ApiError("GET /people → 401", 401);
        },
      },
      paired,
    );
    await c.tick();
    expect(box.cleared).toBe(1);
    expect(c.state.step).toBe("pair");
    expect(c.state.error).toMatch(/disconnected/i);
    expect(box.synced).toBe(0);
  });

  it("says so, and keeps the key, when the coach is off for the account", async () => {
    const { c, box } = setup(
      {
        people: async () => {
          throw new ApiError("GET /people → 403", 403);
        },
      },
      paired,
    );
    await c.tick();
    expect(box.cleared).toBe(0);
    expect(c.state.error).toMatch(/not turned on/i);
  });

  it("stays ready and remembers the people when the server cannot be reached", async () => {
    let offline = false;
    const { c } = setup(
      {
        people: async () => {
          if (offline) throw new Error("fetch failed");
          return [person()];
        },
      },
      paired,
    );
    await c.tick();
    offline = true;
    await c.tick();
    expect(c.state.step).toBe("ready");
    expect(c.state.offline).toBe(true);
    expect(c.state.people).toHaveLength(1);
  });

  it("turns capture on for a person and shows it straight away", async () => {
    const calls: unknown[] = [];
    const { c } = setup(
      {
        people: async () => [person({ captureThread: false })],
        setCapture: async (_cfg, id, on) => {
          calls.push([id, on]);
        },
      },
      paired,
    );
    await c.tick();
    await c.setCapture("p1", true);
    expect(calls).toEqual([["p1", true]]);
    expect(c.state.people[0].capture).toBe(true);
  });

  it("puts the switch back when the change is refused", async () => {
    const { c } = setup(
      {
        people: async () => [person({ captureThread: false })],
        setCapture: async () => {
          throw new Error("nope");
        },
      },
      paired,
    );
    await c.tick();
    await c.setCapture("p1", true);
    expect(c.state.people[0].capture).toBe(false);
    expect(c.state.error).toBeTruthy();
  });

  it("forgets the key when asked to disconnect", async () => {
    const { c, box } = setup({}, paired);
    await c.tick();
    c.disconnect();
    expect(box.config).toBeNull();
    expect(c.state.step).toBe("pair");
    expect(c.state.people).toEqual([]);
  });

  it("waits longer between uploads than between checks during setup", () => {
    const { c } = setup({}, paired);
    c.state.step = "ready";
    const ready = c.waitMs();
    c.state.step = "access";
    expect(c.waitMs()).toBeLessThan(ready);
  });

  describe("adding someone from Messages", () => {
    const threads = [
      { handle: "+15550100", lastAtIso: "2026-11-14T17:45:00.000Z", preview: "look at this" },
      { handle: "sam@example.com", lastAtIso: "2026-11-14T18:30:00.000Z", preview: "Can we talk" },
    ];

    it("offers recent threads that do not belong to anyone yet", async () => {
      const { c } = setup({ recentThreads: () => threads }, paired);
      await c.tick();
      expect(c.state.threads.map((t) => t.handle)).toEqual(["sam@example.com"]);
    });

    it("adds the person with capture on, then shows them under People", async () => {
      const added: unknown[] = [];
      let list = [person()];
      const { c } = setup(
        {
          recentThreads: () => threads,
          people: async () => list,
          addPerson: async (_cfg, input) => {
            added.push(input);
            list = [...list, person({ id: "p2", name: "Sam", handles: ["sam@example.com"] })];
          },
        },
        paired,
      );
      await c.tick();
      await c.addPerson("sam@example.com", "  Sam ");
      expect(added).toEqual([{ name: "Sam", handle: "sam@example.com" }]);
      expect(c.state.people.map((p) => p.name)).toEqual(["Maren", "Sam"]);
      expect(c.state.threads).toEqual([]);
    });

    it("needs a name", async () => {
      const added: unknown[] = [];
      const { c } = setup(
        { recentThreads: () => threads, addPerson: async (_c, i) => void added.push(i) },
        paired,
      );
      await c.tick();
      await c.addPerson("sam@example.com", "   ");
      expect(added).toEqual([]);
    });

    it("says so when adding fails, and keeps the thread on offer", async () => {
      const { c } = setup(
        {
          recentThreads: () => threads,
          addPerson: async () => {
            throw new Error("nope");
          },
        },
        paired,
      );
      await c.tick();
      await c.addPerson("sam@example.com", "Sam");
      expect(c.state.error).toBeTruthy();
      expect(c.state.threads).toHaveLength(1);
    });

    it("still works when Messages cannot be listed", async () => {
      const { c } = setup(
        {
          recentThreads: () => {
            throw new Error("locked");
          },
        },
        paired,
      );
      await c.tick();
      expect(c.state.step).toBe("ready");
      expect(c.state.threads).toEqual([]);
    });
  });
});
