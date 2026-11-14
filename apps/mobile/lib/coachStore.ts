import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { CoachChatMessage, UpNext } from "@cliphy/shared";
import { fromStored, isCoachOff, LOCAL_PREFIX, mergeMessages, newestTime, toStored } from "./coach";
import { chooseButton, getChat, getUpNext, sendChat } from "./coachApi";

// One small store for the coach: whether this account has it, the thread, what
// the bot is doing, and the Up next strip. Screens read it; refreshes feed it.
// The thread and the on/off answer are kept on the phone, so a launch with no
// network still shows Chat and what was last loaded.

const STORAGE_KEY = "cliphy:coach:v1";

export interface CoachState {
  /** "unknown" until the first call answers; "off" means no coach UI and no more calls. */
  status: "unknown" | "on" | "off";
  messages: CoachChatMessage[];
  /** What the bot is doing right now, e.g. ["Reading Maren's message"]. Empty when idle. */
  activity: string[];
  strip: UpNext["strip"] | null;
  /** Bot messages with buttons nobody has tapped yet. */
  waiting: number;
  /** True when the last refresh failed (for example no network). The thread is kept. */
  offline: boolean;
}

const EMPTY: CoachState = {
  status: "unknown",
  messages: [],
  activity: [],
  strip: null,
  waiting: 0,
  offline: false,
};

let state: CoachState = EMPTY;
/** Bumped on sign-out, so a request that was in flight cannot refill the store. */
let epoch = 0;
const listeners = new Set<() => void>();

function set(patch: Partial<CoachState>): void {
  state = { ...state, ...patch };
  if (patch.messages) {
    state.waiting = state.messages.filter(
      (m) => m.role === "bot" && m.buttons.length > 0 && m.chosen === null && m.kind !== "did",
    ).length;
  }
  if ((patch.messages || patch.status) && state.status !== "unknown") {
    AsyncStorage.setItem(STORAGE_KEY, toStored(state)).catch(() => {});
  }
  for (const l of listeners) l();
}

export function useCoach(): CoachState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

export const getCoachState = (): CoachState => state;

/** Load what was saved last time, before the first network call. */
export async function hydrateCoach(): Promise<void> {
  if (state.status !== "unknown") return;
  const mine = epoch;
  const saved = fromStored(await AsyncStorage.getItem(STORAGE_KEY).catch(() => null));
  if (saved && mine === epoch && state.status === "unknown") {
    set({ status: saved.status, messages: saved.messages });
  }
}

let refreshing: Promise<void> | null = null;

/**
 * Fetch what is new. `full` re-reads the newest page instead of only what is
 * newer than the last message: that picks up changes to older cards (a button
 * that was answered elsewhere) and renews attachment links, which expire.
 * Safe to call often; overlapping calls share one request.
 */
export function refreshCoach(opts: { full?: boolean } = {}): Promise<void> {
  if (state.status === "off") return Promise.resolve();
  if (refreshing) return refreshing;
  const mine = epoch;
  refreshing = (async () => {
    try {
      const { messages, activity } = await getChat(
        opts.full ? undefined : newestTime(state.messages),
      );
      if (mine !== epoch) return;
      set({
        status: "on",
        offline: false,
        activity,
        messages: mergeMessages(state.messages, messages),
      });
    } catch (err) {
      if (mine !== epoch) return;
      // Not this account's feature: stop asking. Anything else: keep what we have.
      if (isCoachOff(err)) set({ status: "off", messages: [], activity: [], strip: null });
      else set({ offline: true });
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function refreshStrip(): Promise<void> {
  if (state.status !== "on") return;
  const mine = epoch;
  try {
    const { strip } = await getUpNext();
    if (mine === epoch) set({ strip });
  } catch {
    // The strip is a convenience; leave the last one showing.
  }
}

/** Show what was typed straight away, send it, then let polling bring the reply. */
export async function say(text: string): Promise<boolean> {
  const local: CoachChatMessage = {
    id: `${LOCAL_PREFIX}${Date.now()}`,
    role: "user",
    text,
    attachments: [],
    buttons: [],
    link: null,
    chosen: null,
    kind: "user",
    createdAt: new Date().toISOString(),
  };
  set({ messages: [...state.messages, local] });
  try {
    await sendChat(text);
    void refreshCoach();
    return true;
  } catch {
    // Not sent: take it back out so the caller can keep the text in the box.
    set({ messages: state.messages.filter((m) => m.id !== local.id), offline: true });
    return false;
  }
}

/** Tap a button: mark it at once, then run it. A failed tap is given back. */
export async function tap(messageId: string, index: number): Promise<void> {
  const current = state.messages.find((m) => m.id === messageId);
  // Already tapped (or a second button pressed in the same instant): one tap only.
  if (!current || current.chosen !== null) return;

  const mark = (chosen: number | null) =>
    set({ messages: state.messages.map((m) => (m.id === messageId ? { ...m, chosen } : m)) });
  mark(index);
  try {
    const { message } = await chooseButton(messageId, index);
    set({ messages: state.messages.map((m) => (m.id === messageId ? message : m)) });
    void refreshCoach();
    void refreshStrip();
  } catch {
    mark(null);
    set({ offline: true });
  }
}

/** Forget everything (on sign-out), including what was saved on the phone. */
export function resetCoach(): void {
  epoch++;
  state = EMPTY;
  AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  for (const l of listeners) l();
}
