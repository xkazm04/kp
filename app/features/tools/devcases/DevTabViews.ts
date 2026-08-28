// The Assignments studio's three sub-tab definitions, split out of DevTab.tsx: the
// assignment library first (read + operate), creation second, comms third. Local
// state only — the tab owns its own sub-navigation, the workspace-level ?tab=
// param stays untouched.
//
// ONE THREAD (gap 7): this module holds the only user-facing copy for the surface
// that is NOT in the four catalogs, which is exactly why it kept saying "Cases"
// long after the nav tab, the table header and the empty ledger said Assignment —
// no locale gate reads it. `devcase-vocabulary.test.ts` now source-guards it. Its
// strings being English-only is a SEPARATE, still-open gap: fixing the word costs
// nothing, localizing the module is a change of its own.
import { MAX_CODEBASES } from "@/app/_lib/devcase-constraints";

export const DEV_VIEWS = [
  { id: "cases", label: "Assignments" },
  { id: "define", label: "Define need" },
  { id: "outbox", label: "Outbox" },
] as const;
export type DevView = (typeof DEV_VIEWS)[number]["id"];

export const VIEW_HEADING: Record<DevView, { title: string; blurb: string }> = {
  cases: {
    title: "Active assignments",
    blurb:
      "Every designed assignment in one place — stage, intake and evaluations. Click an assignment to read the full brief and its internal probe material.",
  },
  define: {
    title: "Define the need",
    blurb:
      `Pick the job description and point us at the real codebases it covers (up to ${MAX_CODEBASES}). The engine reflects what the JD says you need against what the code actually is — surfacing the gaps before we design an assignment. Assume the candidate's code is LLM-generated; we'll grade judgment, not typing.`,
  },
  outbox: {
    title: "Comms outbox",
    blurb:
      "Every message the pipeline sent — intake acknowledgements, promote invites, recruiter outreach, and rejections.",
  },
};
