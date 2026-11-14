// "Still needs doing": a request filed as history is read again as a live one.

/**
 * Put on the bundle when the owner reopens it. It is given to the reader the
 * way a "Fix it" note is, and it is how the bundle job knows this is a reopen.
 */
export const REOPEN_NOTE =
  "These are older messages. The owner says what they ask for still needs doing: read them as a request to confirm, not as a reply or as chat.";

/** True for a bundle that is being read again because the owner reopened it. */
export const isReopen = (bundle: { fix_note?: unknown }): boolean =>
  bundle.fix_note === REOPEN_NOTE;
