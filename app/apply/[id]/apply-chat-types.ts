import type { CompletenessGap } from "@/app/_lib/completeness-followup";

// The types the candidate chat's pieces share. They live in their own module so
// the view, the blocks split out of it (ApplyDoneCard / ApplyFollowup /
// ApplyErrorBlock / ApplyStepControls) and the draft + submit hooks can all name
// them without importing one another.

export type Msg = { who: "bot" | "me"; text: string };

// The filed application's outcome, as the server reported it.
// `duplicate` flags a repeat application (the candidate already applied to this
// role): the submission is still "accepted" — their first application stands —
// but we acknowledge it plainly rather than re-celebrating a fresh "You're in".
// `enriched` is the repeat that REBUILT their profile (e.g. a quick-apply lead
// following its enrichment link): that one celebrates — they did what we asked.
export type ApplyOutcome = {
  result: "accepted" | "declined";
  message: string;
  duplicate?: boolean;
  enriched?: boolean;
  statusToken?: string | null;
  // The OPTIONAL post-accept profile-gap follow-up (see ApplyFollowup). Both
  // fields arrive together or not at all.
  followupToken?: string | null;
  followupGaps?: CompletenessGap[];
};
