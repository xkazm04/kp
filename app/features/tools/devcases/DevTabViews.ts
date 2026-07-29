// The Dev studio's three sub-tab definitions, split out of DevTab.tsx: the case
// library first (read + operate), creation second, comms third. Local state
// only — the dev tab owns its own sub-navigation, the workspace-level ?tab=
// param stays untouched.
import { MAX_CODEBASES } from "@/app/_lib/devcase-constraints";

export const DEV_VIEWS = [
  { id: "cases", label: "Cases" },
  { id: "define", label: "Define need" },
  { id: "outbox", label: "Outbox" },
] as const;
export type DevView = (typeof DEV_VIEWS)[number]["id"];

export const VIEW_HEADING: Record<DevView, { title: string; blurb: string }> = {
  cases: {
    title: "Active cases",
    blurb:
      "Every designed assignment in one place — stage, intake and evaluations. Click a case to read the full brief and its internal probe material.",
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
