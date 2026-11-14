import type { RecentThread } from "../../mac-helper/src/messagesDb.js";
import type { CapturedPerson } from "../../mac-helper/src/plan.js";
import type { Paired } from "../../mac-helper/src/pair.js";
import type { HelperConfig } from "../../mac-helper/src/store.js";
import { ApiError, type SyncResult } from "../../mac-helper/src/sync.js";

// What the app is doing and what to do next, with everything that touches the
// Mac or the network passed in. The window and the menu-bar item only draw
// `state`.

/** pair: show a code. access: waiting for Full Disk Access. ready: uploading. */
export type Step = "pair" | "access" | "ready";

export interface AppState {
  step: Step;
  /** The code to type into the phone, while one is waiting. */
  code: string | null;
  account: string | null;
  error: string | null;
  offline: boolean;
  people: { id: string; name: string; capture: boolean; hasHandle: boolean }[];
  /** Recent Messages threads that are nobody's yet, to add with one press. */
  threads: RecentThread[];
  lastSyncAt: string | null;
  /** Messages uploaded by the last cycle. */
  lastUploaded: number;
}

export interface ControllerDeps {
  apiUrl: string;
  loadConfig(): HelperConfig | null;
  saveConfig(config: HelperConfig): void;
  clearConfig(): void;
  /** Runs the whole pairing: calls `show` with the code, resolves when the phone confirms. */
  pair(apiUrl: string, show: (code: string) => void): Promise<Paired>;
  canReadMessages(): boolean;
  people(config: HelperConfig): Promise<CapturedPerson[]>;
  sync(config: HelperConfig): Promise<SyncResult>;
  setCapture(config: HelperConfig, personId: string, on: boolean): Promise<void>;
  recentThreads(): RecentThread[];
  /** Create the person in the app with this handle and capture switched on. */
  addPerson(config: HelperConfig, input: { name: string; handle: string }): Promise<void>;
  now(): Date;
  onChange(state: AppState): void;
}

const READY_WAIT_MS = 20_000;
const SETUP_WAIT_MS = 3_000;
const RETRY_PAIR_MS = 1_000;

export class Controller {
  state: AppState = {
    step: "pair",
    code: null,
    account: null,
    error: null,
    offline: false,
    people: [],
    threads: [],
    lastSyncAt: null,
    lastUploaded: 0,
  };
  private stopped = false;

  constructor(private readonly deps: ControllerDeps) {}

  private set(patch: Partial<AppState>): void {
    Object.assign(this.state, patch);
    this.deps.onChange(this.state);
  }

  /** One step of progress: pair, or check access, or upload. Never throws. */
  async tick(): Promise<void> {
    const config = this.deps.loadConfig();
    if (!config) return this.pairStep();

    if (!this.deps.canReadMessages()) {
      this.set({ step: "access", code: null, account: config.account ?? null });
      return;
    }

    let people: CapturedPerson[];
    try {
      people = await this.deps.people(config);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        this.deps.clearConfig();
        this.set({
          step: "pair",
          account: null,
          people: [],
          threads: [],
          error: "This Mac was disconnected. Connect it again.",
        });
        return;
      }
      if (err instanceof ApiError && err.status === 403) {
        this.set({
          step: "ready",
          account: config.account ?? null,
          error: "The coach is not turned on for this account.",
        });
        return;
      }
      this.set({ step: "ready", account: config.account ?? null, offline: true });
      return;
    }

    this.set({
      step: "ready",
      code: null,
      account: config.account ?? null,
      error: null,
      offline: false,
      ...this.peopleView(people),
    });

    try {
      const result = await this.deps.sync(config);
      this.set({
        offline: result.offline,
        lastUploaded: result.uploaded,
        ...(result.offline ? {} : { lastSyncAt: this.deps.now().toISOString() }),
      });
    } catch (err) {
      this.set({ error: `Upload failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  /** People as the window lists them, and the recent threads that are not theirs. */
  private peopleView(people: CapturedPerson[]): Pick<AppState, "people" | "threads"> {
    const taken = new Set(people.flatMap((p) => p.handles.map((h) => h.toLowerCase())));
    let recent: RecentThread[] = [];
    try {
      recent = this.deps.recentThreads();
    } catch {
      // Choosing from Messages is a convenience; the list of people still works.
    }
    return {
      people: people.map((p) => ({
        id: p.id,
        name: p.name,
        capture: p.captureThread,
        hasHandle: p.handles.length > 0,
      })),
      threads: recent.filter((t) => !taken.has(t.handle.toLowerCase())),
    };
  }

  async addPerson(handle: string, rawName: string): Promise<void> {
    const config = this.deps.loadConfig();
    const name = rawName.trim();
    if (!config || !name) return;
    try {
      await this.deps.addPerson(config, { name, handle });
      this.set({ error: null, ...this.peopleView(await this.deps.people(config)) });
    } catch {
      this.set({ error: "Could not add them. Try again." });
    }
  }

  private async pairStep(): Promise<void> {
    this.set({ step: "pair", code: null });
    try {
      const { apiKey, account } = await this.deps.pair(this.deps.apiUrl, (code) =>
        this.set({ code, error: null }),
      );
      this.deps.saveConfig({ apiUrl: this.deps.apiUrl, apiKey, account: account ?? undefined });
      this.set({ code: null, account, error: null, step: "access" });
    } catch {
      // Expired or unreachable: the next tick asks for a fresh code.
      this.set({ code: null });
    }
  }

  async setCapture(personId: string, on: boolean): Promise<void> {
    const config = this.deps.loadConfig();
    const flip = (capture: boolean) =>
      this.set({
        people: this.state.people.map((p) => (p.id === personId ? { ...p, capture } : p)),
      });
    if (!config) return;
    flip(on);
    try {
      await this.deps.setCapture(config, personId, on);
      this.set({ error: null });
    } catch {
      flip(!on);
      this.set({ error: "Could not change that. Try again." });
    }
  }

  disconnect(): void {
    this.deps.clearConfig();
    this.set({ step: "pair", code: null, account: null, people: [], threads: [], error: null });
  }

  waitMs(): number {
    if (this.state.step === "ready") return READY_WAIT_MS;
    if (this.state.step === "access") return SETUP_WAIT_MS;
    return RETRY_PAIR_MS;
  }

  async run(sleep: (ms: number) => Promise<void>): Promise<void> {
    while (!this.stopped) {
      await this.tick();
      await sleep(this.waitMs());
    }
  }

  stop(): void {
    this.stopped = true;
  }
}
