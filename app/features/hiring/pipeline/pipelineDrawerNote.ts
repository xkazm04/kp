// The candidate drawer's NOTE machine — dirty / flush / hydrate — pure, so
// node --test can pin it.
//
// The persistent per-candidate note has four writers pulling in different directions
// and, until this module, no way to see them together:
//
//   • a 600ms debounce that autosaves whatever is in the textarea;
//   • an unmount FLUSH, because the debounce's cleanup cancels the pending timer and
//     the last thing typed before closing is the thing most worth keeping;
//   • a bundle HYDRATION carrying the server's copy of the note, which must heal a
//     stale board prop (notes are not in entrySignature, so the board's close-refresh
//     sees an identical signature and keeps the pre-edit value) without ever
//     clobbering in-progress typing;
//   • a deferred board REFRESH, owed once per open in which a save landed — the board
//     card's `notes` is stale from that moment, but refreshing on every autosave
//     refetches the whole board behind an open drawer and defeats the poll pause.
//
// Two bugs lived in the gaps: `noteDirtyRef` was never cleared after a successful save
// (so every close after any edit fired a redundant second write), and clearing it
// unconditionally would drop a keystroke typed WHILE that save was in flight. Both are
// now one function with a name.

/** What a completed autosave POST means for the note's bookkeeping. */
export type NoteSaveResolution = {
  status: "saved" | "error";
  /** Clear the dirty flag? Only when the save succeeded AND nothing newer was typed
   *  while it was in flight — otherwise that newer keystroke still owes a write. */
  clearDirty: boolean;
  /** Has a save landed this open? Once true the board's copy is stale and the single
   *  deferred refresh is owed on close. Never goes back to false. */
  savedThisSession: boolean;
};

export function resolveNoteSave(args: {
  /** Did the POST answer 2xx? A throw is `ok: false`. */
  ok: boolean;
  /** The exact content THIS save persisted. */
  savedValue: string;
  /** What the textarea holds now. */
  latestValue: string;
  /** Whether a save had already landed earlier in this open. */
  savedThisSession: boolean;
}): NoteSaveResolution {
  if (!args.ok) {
    // A failed save leaves the note DIRTY on purpose: the unmount flush is the
    // retry, and the field says "error" meanwhile.
    return { status: "error", clearDirty: false, savedThisSession: args.savedThisSession };
  }
  return {
    status: "saved",
    clearDirty: args.latestValue === args.savedValue,
    savedThisSession: true,
  };
}

/** Should the bundle's server-truth note overwrite the textarea? Only when the bundle
 *  has actually landed AND the user has not edited in THIS open. That heals the stale
 *  prop (a note saved in a prior open whose board prop never refreshed) while an
 *  in-place re-pull — a stage move, the 30s poll — can never wipe an unsaved edit. */
export function shouldHydrateNote(bundleNotes: string | null, dirty: boolean): boolean {
  return bundleNotes !== null && !dirty;
}

/** What the drawer owes on unmount (close, or a swap to another candidate). */
export type NoteUnmountAction =
  /** A genuinely unsaved trailing edit: POST it with keepalive, then refresh the board. */
  | "flush"
  /** Nothing left to write, but a save DID land this open — do the single deferred
   *  board refresh now, instead of on every autosave. */
  | "refresh"
  /** The drawer was opened and closed without ever persisting anything. */
  | "none";

export function noteUnmountAction(args: { dirty: boolean; savedThisSession: boolean }): NoteUnmountAction {
  if (args.dirty) return "flush";
  return args.savedThisSession ? "refresh" : "none";
}
