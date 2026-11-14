import { useSyncExternalStore } from "react";

/** Something shared into the app that is waiting for the user to say where it goes. */
export interface PendingShare {
  text: string;
  imageUris: string[];
}

let pending: PendingShare | null = null;
const listeners = new Set<() => void>();

export function setPendingShare(share: PendingShare | null): void {
  pending = share;
  for (const l of listeners) l();
}

export function usePendingShare(): PendingShare | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => pending,
    () => pending,
  );
}

const BARE_LINK = /^https?:\/\/\S+$/;

/**
 * Whether a share could be a request for the bot. A bare link is a clip to
 * save, as it always was; images, or words that are more than a link, could
 * be something a person sent.
 */
export function couldBeRequest(share: PendingShare): boolean {
  if (share.imageUris.length > 0) return true;
  const text = share.text.trim();
  return text.length > 0 && !BARE_LINK.test(text);
}
