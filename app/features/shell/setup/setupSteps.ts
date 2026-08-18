// First-run onboarding — shared step model + state. This is the SimBar "phases"
// idea (constants.ts SIM_PHASES) retargeted from a demo chronology to a
// user-completes-it setup journey: Welcome → Company → Team → Pipeline →
// Hand-off. Copy lives in the `setup` i18n namespace (messages/*.json), not here
// — steps carry ids only, so the catalogs stay the single source of wording.
//
// Step 4 used to be "First role" — the inputs of a real backgrounded JD build.
// It is gone: authoring a job description is a Library job with its own ledger,
// retry and engine caveats, and asking for it inside a modal made the wizard the
// second-best place to do it. The Getting-started checklist now walks the
// operator there (setupGettingStartedModel.ts STEPS: `firstRole` → the Library's
// jd-builder anchor). What replaced it is the one shape decision the whole
// workspace hangs off and that nothing else asks about at first run: the board's
// columns.

// bug-ui-scan-2026-07-09 (organizations-members-invites #4): source the role +
// language vocabularies from the REAL identity model (auth/roles) and the shared
// Organization presenter (member-ui), not the retired sub_organization/mock
// prototype fixture. Onboarding speaks the server enum natively.
import type { AppLanguage } from "@/app/features/shared/memberUi";
import type { MemberRole } from "@/app/_lib/auth/roles";
import type { PipelineStagesRule } from "@/app/_lib/decision-config-schema";
import { axisProblems, type AxisDraft } from "@/app/features/shared/pipelineAxisDraft";

export type SetupStepId = "welcome" | "company" | "team" | "pipeline" | "handoff";

export const SETUP_STEPS: { id: SetupStepId }[] = [
  { id: "welcome" },
  { id: "company" },
  { id: "team" },
  { id: "pipeline" },
  { id: "handoff" },
];

export type SetupInvite = { email: string; role: MemberRole };

/**
 * The board's columns, as the wizard holds them.
 *
 * `stored` is the axis the server had when the step loaded — the baseline the
 * dirty check compares against, so finishing writes NOTHING when the operator
 * accepted the default. `counts` is per-stage occupancy: zero everywhere on a
 * genuinely fresh workspace, but the wizard also opens over a populated one
 * (Settings → "Preview onboarding", `?onboarding=1`), and there a removal the
 * server would refuse must not be offered.
 */
export type SetupPipeline = {
  stored: PipelineStagesRule;
  draft: AxisDraft;
  counts: Record<string, number>;
};

/** Whether the axis read has landed. `failed` is a real state, not a spinner
 *  that never ends: the step says so and lets the operator past — the board keeps
 *  whatever it already had. */
export type SetupPipelineLoad = "loading" | "ready" | "failed";

/** Whether a step's REQUIRED inputs are satisfied — the single gate behind the
 *  footer's Continue AND the rail's forward navigation, so the stepper can't
 *  bypass what the button enforces. Only `company` has a required input; `team`
 *  and `pipeline` are optional — `team` invites nobody by default and
 *  `pipeline` ships a working five-column board, so accepting either unchanged
 *  is a legitimate answer. The pipeline gate is therefore a
 *  VALIDITY check, not a completeness one: an axis the server would reject can't
 *  be carried to the hand-off, but an untouched one is fine. */
export function stepSatisfied(id: SetupStepId, state: SetupState): boolean {
  if (id === "company") return state.orgName.trim().length > 0;
  if (id === "pipeline") {
    if (state.pipelineLoad !== "ready" || !state.pipeline) return true;
    return axisProblems(state.pipeline.draft).length === 0;
  }
  return true;
}

export type SetupState = {
  orgName: string;
  language: AppLanguage;
  /** Brand accent hex, or null = keep the product default (coral). */
  accentColor: string | null;
  /** https:// logo URL ("" = none). */
  logoUrl: string;
  invites: SetupInvite[];
  pipeline: SetupPipeline | null;
  pipelineLoad: SetupPipelineLoad;
};

export const INITIAL_SETUP: SetupState = {
  orgName: "",
  language: "en",
  accentColor: null,
  logoUrl: "",
  invites: [],
  pipeline: null,
  pipelineLoad: "loading",
};

// Shared controller — the onboarding host owns this and hands the SAME object to
// whichever variant is active, so a step's edits survive a variant switch.
export type OnboardingCtrl = {
  /** "live" = the real first run (persists + stamps); "preview" = the Settings
   *  walkthrough (persists NOTHING — the wizard shows a ribbon saying so). */
  mode: "live" | "preview";
  stepIndex: number;
  /** Highest step legitimately reached (via Continue / Skip) — the rail may
   *  navigate freely up to here; beyond it only one step ahead when the current
   *  step's required inputs are satisfied (see stepSatisfied). */
  maxVisited: number;
  goTo: (i: number) => void;
  next: () => void;
  back: () => void;
  state: SetupState;
  update: (patch: Partial<SetupState>) => void;
  addInvite: (invite: SetupInvite) => void;
  removeInvite: (index: number) => void;
  /** Replace the board draft (the pipeline step's only writer). No-op before the
   *  stored axis has landed — there is nothing to diff against yet. */
  setPipelineDraft: (draft: AxisDraft) => void;
  /** Cancel/skip — closes; in live mode this stamps the principal "skipped". */
  onClose: () => void;
  /** Complete — PERSISTS the setup (org name, language, brand, invites, and the
   *  board columns when they were changed), then closes. */
  finish: () => void;
  /** True when the active step's required input is satisfied (gates Next). */
  canAdvance: boolean;
  isLast: boolean;
};
