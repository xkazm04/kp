// First-run onboarding — shared step model + state. This is the SimBar "phases"
// idea (constants.ts SIM_PHASES) retargeted from a demo chronology to a
// user-completes-it setup journey: Welcome → Company → Team → First role →
// Hand-off. Copy lives in the `setup` i18n namespace (messages/*.json), not here
// — steps carry ids only, so the catalogs stay the single source of wording.

// bug-ui-scan-2026-07-09 (organizations-members-invites #4): source the role +
// language vocabularies from the REAL identity model (auth/roles) and the shared
// Organization presenter (member-ui), not the retired sub_organization/mock
// prototype fixture. Onboarding speaks the server enum natively.
import type { AppLanguage } from "@/app/features/shared/memberUi";
import type { MemberRole } from "@/app/_lib/auth/roles";
import { JD_BUILD_NEED_MIN_LENGTH, JD_BUILD_TITLE_MIN_LENGTH } from "@/app/_lib/jd-limits";

export type SetupStepId = "welcome" | "company" | "team" | "firstRole" | "handoff";

export const SETUP_STEPS: { id: SetupStepId }[] = [
  { id: "welcome" },
  { id: "company" },
  { id: "team" },
  { id: "firstRole" },
  { id: "handoff" },
];

export type SetupInvite = { email: string; role: MemberRole };

// The app's real seniority vocabulary (junior · medior · senior · lead). VALUES
// only: these are canonical slugs the server branches on, and their display label
// is the app-wide one — `enums.seniority.<slug>` via useEnumLabel, the same source
// the pipeline, the JD ledger and a published posting read. A label map here would
// be a second, unlocalized vocabulary for the same four values (and this module is
// server-imported, so it cannot hold copy).
export const SENIORITY_VALUES: readonly string[] = ["junior", "medior", "senior", "lead"];

// First role captured during onboarding. Two paths:
//   "write"  — the inputs of the REAL backgrounded build (POST /api/jds/generate):
//              finish() starts a description + market-salary + case-design run
//              that lands in the Library ledger.
//   "import" — an EXISTING job description (uploaded .pdf/.docx/.txt/.md via
//              /api/extract-text, or pasted): finish() saves it as-is
//              (POST /api/jds) and ingests it as a matchable job — no AI build.
export type RoleMode = "write" | "import";
export type RoleDraft = {
  mode: RoleMode;
  title: string;
  seniority: string;
  roleFamily: string;
  needText: string;
  /** Import path: the full JD text (extracted from a file or pasted). */
  importedBody: string;
  /** Import path: the source file's name (display only). */
  importedFileName: string | null;
};

/** The generate contract is satisfied — same thresholds as the Library builder
 *  (jd-limits.ts), so the wizard can't submit what the API would reject. */
export function roleDraftReady(role: RoleDraft): boolean {
  return role.title.trim().length >= JD_BUILD_TITLE_MIN_LENGTH && role.needText.trim().length >= JD_BUILD_NEED_MIN_LENGTH;
}

/** The import contract is satisfied: a title plus a non-empty JD body. */
export function roleImportReady(role: RoleDraft): boolean {
  return role.title.trim().length >= JD_BUILD_TITLE_MIN_LENGTH && role.importedBody.trim().length > 0;
}

/** The active mode's required inputs are complete (gates Continue on the step). */
export function roleStepComplete(role: RoleDraft): boolean {
  return role.mode === "import" ? roleImportReady(role) : roleDraftReady(role);
}

/** Nothing entered at all — the step was skipped, not half-filled. */
export function roleDraftEmpty(role: RoleDraft): boolean {
  return role.title.trim() === "" && role.needText.trim() === "" && role.importedBody.trim() === "";
}

/** Whether a step's REQUIRED inputs are satisfied — the single gate behind the
 *  footer's Continue AND the rail's forward navigation, so the stepper can't
 *  bypass what the button enforces. Steps without required inputs (welcome,
 *  team, hand-off) are always satisfied; team/firstRole stay explicitly
 *  skippable via the footer's "Skip for now" (which advances past the gate). */
export function stepSatisfied(id: SetupStepId, state: SetupState): boolean {
  if (id === "company") return state.orgName.trim().length > 0;
  if (id === "firstRole") return roleStepComplete(state.role);
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
  role: RoleDraft;
};

export const INITIAL_SETUP: SetupState = {
  orgName: "",
  language: "en",
  accentColor: null,
  logoUrl: "",
  invites: [],
  role: {
    mode: "write",
    title: "",
    seniority: "senior",
    roleFamily: "software_engineering",
    needText: "",
    importedBody: "",
    importedFileName: null,
  },
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
  /** Cancel/skip — closes; in live mode this stamps the principal "skipped". */
  onClose: () => void;
  /** Complete — PERSISTS the setup (org name, language, brand, invites) and
   *  starts the first role's REAL backgrounded build, then closes. */
  finish: () => void;
  /** True when the active step's required input is satisfied (gates Next). */
  canAdvance: boolean;
  isLast: boolean;
};
