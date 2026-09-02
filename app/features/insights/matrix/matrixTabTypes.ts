// Types + pure presentation helpers for the Fit Matrix tab. Split out of
// MatrixTab.tsx so the tab's data-shape plumbing has its own module — no JSX
// here, so it's a plain .ts file.
import { normalizeArchetype } from "@/app/_lib/archetypes";
import type { Reasoning } from "@/app/features/shared/matchTypes";
import type { Cell } from "./matrixCellClass";

export type Candidate = { id: string; label: string; archetype: string | null };
export type Position = { id: string; title: string; seniority: string; roleFamily: string };
export type Matrix = {
  candidates: Candidate[];
  positions: Position[];
  cells: Cell[][];
  // Requested positions that couldn't be scored (job record missing) — flagged
  // so the grid never quietly omits a column the recruiter asked for.
  missing: { id: string; title: string }[];
  // Candidates whose profile failed to validate/transform — flagged (with the error)
  // so the grid never quietly omits a row, the symmetric counterpart to `missing`.
  missingCandidates: { id: string; label: string; error: string }[];
  placements: Record<string, { stage: string; status: string }>;
  // Unclamped candidate-pool size vs the per-request cap. When poolTotal > poolCap
  // the grid scored only the first poolCap candidates; surfaced so the pool cap is
  // no longer a silent omission (skill-matrix-coverage #1).
  poolTotal?: number;
  poolCap?: number;
  // Whether /api/matrix served this grid from its scored-grid cache (route.ts::respond)
  // rather than re-spawning the scorer. Reported so the recruiter can tell a stale-ish
  // read from a fresh pass before acting on it.
  cached?: boolean;
};

// `cached` and `narrativeLang` mirror what /api/match/reasoning actually returns and what
// focus mode (MatchReasoningPanel) already renders: whether the answer came from the
// reasoning cache, and which language the engine wrote it in (it writes only en/cs).
export type ReasonState = { loading?: boolean; error?: string; data?: Reasoning; source?: string; cached?: boolean; narrativeLang?: string };
export type Popover = { candId: string; posId: string; cand: Candidate; pos: Position; cell: Cell; rect: { top: number; left: number } };

// Dot colours are pure presentation, keyed by the canonical archetype id. The id set and
// short labels come from the shared registry (ARCHETYPE_BADGE — the same source the Match
// tab uses), so a newly added archetype renders with its OWN label (and a neutral dot when
// no colour is configured) instead of silently mislabelling as bau/"Experienced".
const ARCH_DOT: Record<string, string> = {
  bau: "bg-steel",
  student: "bg-coral",
  career_switcher: "bg-moss",
};
const ARCH_DOT_FALLBACK = "bg-stone-400";

// Returns the dot colour + the canonical archetype id; the display label is
// resolved via useEnumLabel("archetype", id) at the call site.
export function archStyle(archetype: string | null): { bg: string; id: string } {
  const id = normalizeArchetype(archetype) || "bau"; // null/blank → the experienced default, as before
  return { bg: ARCH_DOT[id] ?? ARCH_DOT_FALLBACK, id };
}

export const STAGE_INITIAL: Record<string, string> = {
  Accepted: "A",
  Screened: "S",
  Interview: "I",
  Offer: "O",
  Hired: "H",
};
