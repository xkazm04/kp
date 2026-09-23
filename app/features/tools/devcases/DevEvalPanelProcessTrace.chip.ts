// The DECISIONS-log chip of DevEvalPanelProcessTrace, as pure data so node:test can
// hold all three states (kp cannot import .tsx in unit tests).
//
// `processTrace.decisionsLogPresent` is tri-state since the GitHub transport learned
// to say "unreadable" (github-repo-intelligence/A): `true` the log is in the tree,
// `false` the tree was read and the log is not there, `null` the tree could not be
// read. Only `false` is a real absence, so only `false` is coral. An unread tree is
// a fact about the read, not about the candidate: neutral chip, its own copy, and
// scoreAuthenticity deducts nothing for it (decisionsLogUnread). `undefined` (the
// field absent from the bundle) says nothing either and renders the same way.

export type DecisionsLogChipState = "kept" | "missing" | "unread";

export type DecisionsLogChip = {
  state: DecisionsLogChipState;
  /** Key under `devcase.processTrace`. */
  key: "decisionsLogKept" | "decisionsLogMissing" | "decisionsLogUnread";
  /** Tooltip key under `devcase.processTrace`, when the chip needs one. */
  titleKey: "decisionsLogUnreadTitle" | null;
  className: string;
};

export function decisionsLogChip(present: boolean | null | undefined): DecisionsLogChip {
  if (present === true) {
    return { state: "kept", key: "decisionsLogKept", titleKey: null, className: "bg-moss/10 text-moss" };
  }
  if (present === false) {
    return { state: "missing", key: "decisionsLogMissing", titleKey: null, className: "bg-coral/15 text-coral" };
  }
  return {
    state: "unread",
    key: "decisionsLogUnread",
    titleKey: "decisionsLogUnreadTitle",
    className: "bg-paper text-steel",
  };
}
