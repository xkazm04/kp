// Assignments as an ADDRESS (challenge-r03 devcase-workspace/B).
//
// Three surfaces send a reader to this tab with a destination in mind: the Control
// Room's Art. 22 gate Review link (`/?tab=assignments&lifecycle=<id>`, GatesPanel),
// the job page's "N assignments" chip (`?job=<jobId>`, JobsLifecycleStrip) and any
// share of one case (`?case=<id>`). The tab used to read none of it - view and
// selection were local state and the review panel opened only on its own click - so
// a reviewer sent to sign off a gate landed on an unfocused table and had to search.
//
// The rules live here, pure: which intent an address carries, what it resolves to
// against what the tab has loaded, and what the address bar keeps once it is used.
// DevTab owns only the React plumbing. The params are ONE-SHOT, like ?arm= in
// useDecisionsQueue: consumed on arrival, stripped via history.replaceState, and
// tab-scoped (TAB_SCOPED_PARAM_KEYS) so a bare tab switch never carries them along.

/** Read in precedence order: a case is the most specific address, a job the least. */
export const ASSIGNMENTS_LINK_PARAMS = ["case", "lifecycle", "job"] as const;

export type AssignmentsLinkKind = (typeof ASSIGNMENTS_LINK_PARAMS)[number];

export type AssignmentsLink = { kind: AssignmentsLinkKind; id: string };

/** GET /api/devcase/lifecycle answers the newest this-many lifecycles only
 *  (listLifecycles(50)). A full window cannot prove that an id does not exist. */
export const LIFECYCLE_WINDOW = 50;

export type AssignmentsNotice =
  /** The gate the link was minted for has been decided since: the lifecycle is
   *  focused, its current stage named, and there is no review to open. */
  | { kind: "gateDecided"; stage: string }
  /** Not among a complete lifecycle list: removed, or another team's. */
  | { kind: "lifecycleMissing" }
  /** Not among the listed lifecycles, but the list is the newest window only. */
  | { kind: "lifecycleOutsideWindow" };

export type AssignmentsResolution =
  /** The list this intent resolves against has not loaded yet: ask again after. */
  | { pending: true }
  | {
      view: "cases";
      /** A lifecycle awaiting approval whose review panel opens. */
      openReview?: string;
      /** A lifecycle row scrolled into view. */
      focus?: string;
      /** The case whose reader opens (read by id, so the loaded page is irrelevant). */
      selectedCaseId?: string;
      /** The ledger's job filter. */
      jobFilter?: string;
      notice?: AssignmentsNotice;
    };

const toParams = (search: string | URLSearchParams) =>
  typeof search === "string" ? new URLSearchParams(search) : search;

/** The one intent an address carries, or null. Blank values are no intent. */
export function parseAssignmentsLink(search: string | URLSearchParams): AssignmentsLink | null {
  const params = toParams(search);
  for (const kind of ASSIGNMENTS_LINK_PARAMS) {
    const id = (params.get(kind) ?? "").trim();
    if (id) return { kind, id };
  }
  return null;
}

/** A stable key for one intent: an arrival is this key CHANGING, not being present. */
export function assignmentsLinkKey(link: AssignmentsLink | null): string | null {
  return link ? `${link.kind}:${link.id}` : null;
}

/** What an intent means against what is loaded. An address that cannot be honoured
 *  leaves the reader's selection alone and says why, rather than silently showing
 *  the table (the navigation-model rule for arrivals into a standing session). */
export function resolveAssignmentsLink(
  link: AssignmentsLink,
  ctx: { lifecycles: ReadonlyArray<{ id: string; stage: string }>; loaded: boolean },
): AssignmentsResolution {
  if (link.kind === "case") return { view: "cases", selectedCaseId: link.id };
  if (link.kind === "job") return { view: "cases", jobFilter: link.id };
  if (!ctx.loaded) return { pending: true };
  const lc = ctx.lifecycles.find((item) => item.id === link.id);
  if (!lc) {
    return {
      view: "cases",
      notice: { kind: ctx.lifecycles.length >= LIFECYCLE_WINDOW ? "lifecycleOutsideWindow" : "lifecycleMissing" },
    };
  }
  if (lc.stage === "awaiting_approval") return { view: "cases", openReview: lc.id, focus: lc.id };
  return { view: "cases", focus: lc.id, notice: { kind: "gateDecided", stage: lc.stage } };
}

/** The query once the address is used: the three params gone, everything else kept
 *  in order. No leading "?". */
export function consumedSearch(search: string): string {
  const params = new URLSearchParams(search);
  for (const key of ASSIGNMENTS_LINK_PARAMS) params.delete(key);
  return params.toString();
}
