// The wizard's answers, kept across a reload.
//
// Onboarding state was plain `useState`, so a refresh (or an accidental
// navigation) three steps in lost the org name, the accent, the logo, every
// staged invite and the board draft — and, because the '/' gate only stops firing
// once the stamp is written, the wizard came back at step 0 with an empty form.
// That is the worst reload in the app: it is the operator's FIRST five minutes.
//
// sessionStorage, not localStorage, and per user:
//   • session — an abandoned first run should not haunt a new browser session
//     with half-typed answers; the same reason the profile intake picks it
//     (useProfileEditorFields.ts).
//   • per user — sessionStorage survives a logout/login inside one tab, so an
//     unkeyed draft would hand the next principal the previous one's org name and
//     invitees. The scope comes from GET /api/me/onboarding.
//
// Everything here is pure except the three storage helpers at the bottom, and
// every storage access is wrapped: sessionStorage THROWS outright in some privacy
// modes rather than returning null.
import type { AxisDraft } from "@/app/features/shared/pipelineAxisDraft";
import type { AppLanguage } from "@/app/features/shared/memberUi";
import { isMemberRole } from "@/app/_lib/auth/roles";
import type { CompanionBrainChoice } from "@/app/_lib/companion-brain-probe";
import type { SetupInvite, SetupState } from "./setupSteps";

export const SETUP_DRAFT_PREFIX = "kp-setup-draft";

/**
 * The storage key for one principal.
 *
 * A null scope (the identity-less open-dev session, or a scope probe that has not
 * landed yet) gets its OWN key rather than sharing a keyless one: "we do not know
 * who this is" and "this is user u_42" must never read the same slot.
 */
export function setupDraftKey(scope: string | null): string {
  return `${SETUP_DRAFT_PREFIX}:${scope && scope.trim() ? scope.trim() : "anonymous"}`;
}

/**
 * What is persisted. NOT the whole SetupState: `pipeline.stored`/`counts` and the
 * brain probe are SERVER truth re-read on every mount, and restoring a stale copy
 * of them would make the dirty check lie about what changed. Only the operator's
 * own answers travel — including the axis DRAFT, which is one of them.
 *
 * `logoUrl` is a plain https:// string (SetupCompanyStep validates it with
 * sanitizeLogoUrl), so there is no blob or File in this state and nothing has to
 * be dropped to make it serialize.
 */
export type SetupDraft = {
  orgName: string;
  language: AppLanguage;
  accentColor: string | null;
  logoUrl: string;
  invites: SetupInvite[];
  companionChoice: CompanionBrainChoice;
  axisDraft: AxisDraft | null;
  stepIndex: number;
  maxVisited: number;
};

export function draftFromState(state: SetupState, stepIndex: number, maxVisited: number): SetupDraft {
  return {
    orgName: state.orgName,
    language: state.language,
    accentColor: state.accentColor,
    logoUrl: state.logoUrl,
    invites: state.invites,
    companionChoice: state.companionChoice,
    axisDraft: state.pipeline?.draft ?? null,
    stepIndex,
    maxVisited,
  };
}

/** Is there anything worth keeping? A wizard opened and abandoned on step 0 writes
 *  nothing, so a reload of an untouched first run behaves exactly as before. */
export function draftIsEmpty(draft: SetupDraft): boolean {
  return (
    draft.orgName.trim() === "" &&
    draft.accentColor === null &&
    draft.logoUrl.trim() === "" &&
    draft.invites.length === 0 &&
    draft.companionChoice === null &&
    draft.axisDraft === null &&
    draft.stepIndex === 0
  );
}

/**
 * Parse whatever was in storage back into a draft, field by field.
 *
 * Deliberately paranoid: the value is attacker-adjacent (any script on the origin
 * can write it) and, more mundanely, it can simply be a draft from an older
 * shape. Anything that does not match its expected type falls back to the
 * caller's base value rather than poisoning the state — a restored invite at a
 * role that is not a MemberRole would otherwise reach a server write as an
 * unvalidated string.
 */
export function parseSetupDraft(raw: string | null, base: SetupState): SetupDraft | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null; // a corrupt slot is a missing slot
  }
  if (!value || typeof value !== "object") return null;
  const d = value as Record<string, unknown>;
  const invites = Array.isArray(d.invites)
    ? d.invites.filter(
        (i): i is SetupInvite =>
          Boolean(i) &&
          typeof i === "object" &&
          typeof (i as SetupInvite).email === "string" &&
          isMemberRole((i as SetupInvite).role)
      )
    : [];
  const choice = d.companionChoice;
  return {
    orgName: typeof d.orgName === "string" ? d.orgName : base.orgName,
    language: typeof d.language === "string" ? (d.language as AppLanguage) : base.language,
    accentColor: typeof d.accentColor === "string" ? d.accentColor : null,
    logoUrl: typeof d.logoUrl === "string" ? d.logoUrl : "",
    invites,
    companionChoice: choice === "birth" || choice === "connect" ? choice : null,
    axisDraft: isAxisDraft(d.axisDraft) ? d.axisDraft : null,
    stepIndex: typeof d.stepIndex === "number" && Number.isInteger(d.stepIndex) && d.stepIndex >= 0 ? d.stepIndex : 0,
    maxVisited: typeof d.maxVisited === "number" && Number.isInteger(d.maxVisited) && d.maxVisited >= 0 ? d.maxVisited : 0,
  };
}

function isAxisDraft(v: unknown): v is AxisDraft {
  if (!v || typeof v !== "object") return false;
  const d = v as AxisDraft;
  return Array.isArray(d.stages) && d.stages.length > 0 && Array.isArray(d.retired);
}

/**
 * Merge a restored draft into live state — THE TYPING WINS.
 *
 * The scope probe is a fetch, so the restore lands a tick or two after the wizard
 * has already painted its first input. A blind overwrite would therefore be able
 * to eat a keystroke: type into the org name in that window and the restore drops
 * it on the floor. So each field is taken from the draft only while the live value
 * is still exactly what INITIAL_SETUP put there — i.e. only where the operator has
 * not answered in this mount.
 *
 * `pipeline` is NOT touched: it is null on mount and the axis read fills it in
 * from the server a moment later. The restored axis draft is applied separately
 * once that read lands (OnboardingExperience), so the dirty check keeps comparing
 * against the server's real baseline.
 */
export function mergeSetupDraft(base: SetupState, draft: SetupDraft | null, initial: SetupState): SetupState {
  if (!draft) return base;
  return {
    ...base,
    orgName: base.orgName === initial.orgName ? draft.orgName : base.orgName,
    // `language` is seeded from the running locale, not from INITIAL_SETUP, so the
    // caller passes the seeded value as `initial` — an operator who switched the
    // language in this mount keeps their switch.
    language: base.language === initial.language ? draft.language : base.language,
    accentColor: base.accentColor === initial.accentColor ? draft.accentColor : base.accentColor,
    logoUrl: base.logoUrl === initial.logoUrl ? draft.logoUrl : base.logoUrl,
    invites: base.invites.length === 0 ? draft.invites : base.invites,
    companionChoice: base.companionChoice === initial.companionChoice ? draft.companionChoice : base.companionChoice,
  };
}

/** Where a restored draft may resume. Clamped to the steps that exist, and never
 *  above the high-water mark it recorded — a draft claiming step 99 must not open
 *  the hand-off on a workspace that never reached it. */
export function restoredStepIndex(draft: SetupDraft, stepCount: number): { stepIndex: number; maxVisited: number } {
  const maxVisited = Math.min(Math.max(draft.maxVisited, draft.stepIndex), Math.max(0, stepCount - 1));
  return { stepIndex: Math.min(Math.max(0, draft.stepIndex), maxVisited), maxVisited };
}

/* ── storage (the only impure part) ──────────────────────────────────────── */

function store(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    /* privacy modes make the ACCESSOR throw, not just the read */
    return null;
  }
}

export function readSetupDraft(scope: string | null, base: SetupState): SetupDraft | null {
  try {
    return parseSetupDraft(store()?.getItem(setupDraftKey(scope)) ?? null, base);
  } catch {
    /* an unreadable draft is a missing draft — first run must never fail to open */
    return null;
  }
}

export function writeSetupDraft(scope: string | null, draft: SetupDraft): void {
  try {
    if (draftIsEmpty(draft)) store()?.removeItem(setupDraftKey(scope));
    else store()?.setItem(setupDraftKey(scope), JSON.stringify(draft));
  } catch {
    /* a full or blocked store only costs the reload-resume, never the setup */
  }
}

export function clearSetupDraft(scope: string | null): void {
  try {
    store()?.removeItem(setupDraftKey(scope));
  } catch {
    /* nothing to do; the draft is per-session and expires with the tab anyway */
  }
}
