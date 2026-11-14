import { useSyncExternalStore } from "react";
import type { CoachChatMessage, UpNext } from "@cliphy/shared";
import { isCoachOff, LOCAL_PREFIX, mergeMessages, newestTime } from "./coach";
import { chooseButton, getChat, getUpNext, sendChat } from "./coachApi";

// One small store for the coach: whether this account has it, the thread, what
// the bot is doing, and the Up next strip. Screens read it; one poller feeds it.

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

let state: CoachState = {
  status: "unknown",
  messages: [],
  activity: [],
  strip: null,
  waiting: 0,
  offline: false,
};
const listeners = new Set<() => void>();

function set(patch: Partial<CoachState>): void {
  state = { ...state, ...patch };
  if (patch.messages) {
    state.waiting = state.messages.filter(
      (m) => m.role === "bot" && m.buttons.length > 0 && m.chosen === null && m.kind !== "did",
    ).length;
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

let refreshing: Promise<void> | null = null;

/** Fetch anything new. Safe to call often; overlapping calls share one request. */
export function refreshCoach(): Promise<void> {
  if (state.status === "off") return Promise.resolve();
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const { messages, activity } = await getChat(newestTime(state.messages));
      set({
        status: "on",
        offline: false,
        activity,
        messages: mergeMessages(state.messages, messages),
      });
    } catch (err) {
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
  try {
    set({ strip: (await getUpNext()).strip });
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

/** Forget everything (on sign-out). */
export function resetCoach(): void {
  set({ status: "unknown", messages: [], activity: [], strip: null, offline: false });
}
