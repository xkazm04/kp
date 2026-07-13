// First-run onboarding — shared step model + state. The org setup is step 1, so
// the flow reuses the Organization page's types (AppLanguage, MemberRole). This
// is the SimBar "phases" idea (constants.ts SIM_PHASES) retargeted from a demo
// chronology to a user-completes-it setup journey.

// bug-ui-scan-2026-07-09 (organizations-members-invites #4): source the role +
// language vocabularies from the REAL identity model (auth/roles) and the shared
// Organization presenter (member-ui), not the retired sub_organization/mock
// prototype fixture. Onboarding now speaks the server enum natively — no parallel
// capitalized-label enum and no lossy label→slug translation seam.
import type { AppLanguage } from "@/app/features/sub_organization/member-ui";
import type { MemberRole } from "@/app/_lib/auth/roles";

export type SetupStepId = "organization" | "language" | "team" | "jobDescription" | "done";

export const SETUP_STEPS: { id: SetupStepId; label: string; title: string; blurb: string }[] = [
  {
    id: "organization",
    label: "Organization",
    title: "Name your organization",
    blurb: "This is how your company appears across KP — on job posts, offers, and to your teammates.",
  },
  {
    id: "language",
    label: "Language",
    title: "Choose your app language",
    blurb: "The default language your team sees. You can change it any time in Settings → Organization.",
  },
  {
    id: "team",
    label: "Invite team",
    title: "Bring your team in",
    blurb: "Invite the recruiters and hiring managers you'll work with. You can skip and do this later.",
  },
  {
    id: "jobDescription",
    label: "First role",
    title: "Post your first role",
    blurb: "Write a job description or import one you already have — KP turns it into a live hiring pipeline.",
  },
  {
    id: "done",
    label: "Done",
    title: "You're all set",
    blurb: "Your workspace is ready. KP will source and screen candidates against your first role.",
  },
];

export type SetupInvite = { email: string; role: MemberRole };

// First job draft captured during onboarding. `mode` toggles between authoring
// one in-flow ("write") and pasting an existing posting ("import"); `seniority`
// uses the app's real vocabulary (junior · medior · senior · lead).
export type JobDraftMode = "write" | "import";
export const SENIORITY_OPTIONS: { value: string; label: string }[] = [
  { value: "junior", label: "Junior" },
  { value: "medior", label: "Medior" },
  { value: "senior", label: "Senior" },
  { value: "lead", label: "Lead" },
];
export type JobDraft = { mode: JobDraftMode; title: string; seniority: string; body: string };

export type SetupState = {
  orgName: string;
  language: AppLanguage;
  invites: SetupInvite[];
  job: JobDraft;
};

export const INITIAL_SETUP: SetupState = {
  orgName: "",
  language: "en",
  invites: [],
  job: { mode: "write", title: "", seniority: "senior", body: "" },
};

// Shared controller — the onboarding host owns this and hands the SAME object to
// whichever variant is active, so a step's edits survive a variant switch.
export type OnboardingCtrl = {
  stepIndex: number;
  goTo: (i: number) => void;
  next: () => void;
  back: () => void;
  state: SetupState;
  update: (patch: Partial<SetupState>) => void;
  addInvite: (invite: SetupInvite) => void;
  removeInvite: (index: number) => void;
  /** Cancel/skip — discards the setup and closes. */
  onClose: () => void;
  /** Complete — PERSISTS the setup (org name, language, invites, first role) then
   *  closes. Distinct from onClose, which throws the draft away. */
  finish: () => void;
  /** True when the active step's required input is satisfied (gates Next). */
  canAdvance: boolean;
  isLast: boolean;
};
