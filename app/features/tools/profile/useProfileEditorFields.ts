// Form field state + the AI-draft hydration split out of ProfileEditor.tsx: one hook owns
// every input the editor reads/writes, plus applyDraft (the payload→form mapping shared by
// edit/duplicate hydration and an AI draft).
//
// The state is ONE object (profileDraftMerge.ProfileFormState) rather than seventeen
// useStates, because three things need the whole form at once and could not have it before:
//   - mergeDraft, which compares the live form against the values it LOADED with so an AI
//     draft stops silently replacing hand edits;
//   - the undo that restores the pre-draft form in one click;
//   - the per-profile sessionStorage backup, so Back or a browser refresh no longer
//     discards a long intake.
// The per-field setters below are derived from that object, so ProfileEditorFields and
// ProfileEvidenceColumn see exactly the same `value`/`setValue` pairs as before.
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { SkillRow, EvidenceRow } from "@/app/features/shared/profileTypes";
import { hydrate, SKILL_FALLBACK, EVIDENCE_FALLBACK } from "./ProfileForm";
import type { ProfileDraft } from "./ProfileEditorAiDraft";
import type { ProfilePayload } from "@/app/features/shared/profileTypes";
import { mergeDraft, type ProfileFormField, type ProfileFormState } from "./profileDraftMerge";

// sessionStorage (not localStorage) on purpose: an abandoned intake should not
// outlive the tab, and a second tab editing a DIFFERENT profile must not inherit
// this one's draft. Keyed per profile id so an edit of A never restores into B;
// a create shares the "new" slot, which is the same slot the recruiter left.
const BACKUP_PREFIX = "kp.profileEditor.";
export function profileEditorBackupKey(editingId: string | null): string {
  return `${BACKUP_PREFIX}${editingId ?? "new"}`;
}

// hydrate() maps a stored payload (edit/duplicate) — or null (blank create) — into form
// state honestly: it never pre-fills education/languages/seniority the candidate didn't
// declare, so a blank intake's completeness reflects real input rather than unchosen
// defaults (idea-fa7d5360). Create and edit are identical.
function formStateFrom(payload: ProfilePayload | null, archetype?: string): ProfileFormState {
  const h = hydrate(payload);
  return {
    choice: archetype || h.choice,
    isEnrolled: false,
    expectedGraduation: "",
    wantsDomainChange: false,
    hasSubstantialExperience: false,
    displayName: h.displayName,
    roleFamily: h.roleFamily,
    educationLevel: h.educationLevel,
    educationDetail: h.educationDetail,
    languages: h.languages,
    location: h.location,
    availability: h.availability,
    yearsExperience: h.yearsExperience,
    seniority: h.seniority,
    aspirations: h.aspirations,
    skills: h.skills.length ? h.skills : SKILL_FALLBACK,
    evidence: h.evidence.length ? h.evidence : EVIDENCE_FALLBACK,
  };
}

// A drafted profile is source data — reflect it faithfully so the AI's omissions
// aren't backfilled with values the candidate never gave.
function draftFormState(draft: ProfileDraft): ProfileFormState {
  const s = draft.signals ?? {};
  return {
    ...formStateFrom(draft.profile, draft.archetype),
    isEnrolled: Boolean(s.isEnrolled),
    expectedGraduation: s.expectedGraduation ?? "",
    wantsDomainChange: Boolean(s.wantsDomainChange),
    hasSubstantialExperience: Boolean(s.hasSubstantialExperience),
  };
}

export function useProfileEditorFields(initialPayload: ProfilePayload | null, editingId: string | null) {
  // The values this editing session LOADED with. mergeDraft compares against them to
  // tell "the recruiter typed this" from "this is just what the profile already said".
  // Held in state (not a ref) so the lazy initializer runs exactly once — hydrate()
  // mints fresh row `_id`s on every call and a per-render baseline would report every
  // row list as hand-edited.
  const [baseline] = useState<ProfileFormState>(() => formStateFrom(initialPayload));
  const [state, setState] = useState<ProfileFormState>(baseline);

  // The form as it stood immediately BEFORE the last applied draft, and the fields that
  // draft was refused. Together they are the undo + the "use the draft anyway" offer.
  const [pending, setPending] = useState<{ before: ProfileFormState; draft: ProfileFormState; kept: ProfileFormField[] } | null>(null);

  const backupKey = profileEditorBackupKey(editingId);
  // Writing must not begin until the restore attempt has run, or the empty first render
  // would overwrite the very backup it is about to read.
  const restored = useRef(false);

  // Restore a backed-up intake AFTER mount (sessionStorage does not exist during the
  // server render, and reading it in the initializer would desync hydration). Deferred
  // through a 0ms timer — no synchronous setState in an effect body, the repo's pattern.
  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      if (!alive) return;
      try {
        const raw = window.sessionStorage.getItem(backupKey);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<ProfileFormState> | null;
          // Spread over the loaded state, never replace it: a backup written by an older
          // build can be missing fields this one has, and a partial restore must not
          // blank them.
          if (parsed && typeof parsed === "object") setState((s) => ({ ...s, ...parsed }));
        }
      } catch {
        /* best-effort: a private window, a full quota or a disabled store must never
           stop the editor from opening — the recruiter simply starts from the payload. */
      }
      restored.current = true;
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [backupKey]);

  // Back it up on every change once the restore has settled.
  useEffect(() => {
    if (!restored.current) return;
    try {
      window.sessionStorage.setItem(backupKey, JSON.stringify(state));
    } catch {
      /* best-effort: quota/private-mode failures cost the recruiter the safety net,
         never the edit in front of them. */
    }
  }, [backupKey, state]);

  /** Drop this editor's backup — called when the intake is saved or abandoned, so a
   *  finished draft never springs back into the next session. */
  const clearBackup = useCallback(() => {
    try {
      window.sessionStorage.removeItem(backupKey);
    } catch {
      /* best-effort: an unremovable backup is harmless — it is overwritten by the
         next edit of the same profile and dies with the tab. */
    }
  }, [backupKey]);

  // Per-field setters derived from the single object, memoized so their identities are
  // stable across renders exactly like the useState setters they replace.
  const setField = useCallback(
    <K extends ProfileFormField>(key: K) =>
      (value: SetStateAction<ProfileFormState[K]>) =>
        setState((s) => ({
          ...s,
          [key]: typeof value === "function" ? (value as (prev: ProfileFormState[K]) => ProfileFormState[K])(s[key]) : value,
        })),
    []
  );

  const setters = useMemo(
    () => ({
      setChoice: setField("choice") as Dispatch<SetStateAction<string>>,
      setIsEnrolled: setField("isEnrolled") as Dispatch<SetStateAction<boolean>>,
      setExpectedGraduation: setField("expectedGraduation") as Dispatch<SetStateAction<string>>,
      setWantsDomainChange: setField("wantsDomainChange") as Dispatch<SetStateAction<boolean>>,
      setHasSubstantialExperience: setField("hasSubstantialExperience") as Dispatch<SetStateAction<boolean>>,
      setDisplayName: setField("displayName") as Dispatch<SetStateAction<string>>,
      setRoleFamily: setField("roleFamily") as Dispatch<SetStateAction<string>>,
      setEducationLevel: setField("educationLevel") as Dispatch<SetStateAction<string>>,
      setEducationDetail: setField("educationDetail") as Dispatch<SetStateAction<string>>,
      setLanguages: setField("languages") as Dispatch<SetStateAction<string>>,
      setLocation: setField("location") as Dispatch<SetStateAction<string>>,
      setAvailability: setField("availability") as Dispatch<SetStateAction<string>>,
      setYearsExperience: setField("yearsExperience") as Dispatch<SetStateAction<string>>,
      setSeniority: setField("seniority") as Dispatch<SetStateAction<string>>,
      setAspirations: setField("aspirations") as Dispatch<SetStateAction<string>>,
      setSkills: setField("skills") as Dispatch<SetStateAction<SkillRow[]>>,
      setEvidence: setField("evidence") as Dispatch<SetStateAction<EvidenceRow[]>>,
    }),
    [setField]
  );

  // The live state, readable from a callback without re-creating it per render.
  // applyDraft is invoked from the AI panel's deferred outcome handler — after
  // render and effects — so an effect-synced ref is current there, and the merge
  // can be computed OUTSIDE the setState updater (updaters must stay pure; React
  // may run one twice).
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  /** Push an AI (or any) hydrated draft into the live form — MERGED, never wholesale.
   *  Fields the recruiter changed since load survive; the ones the draft was refused
   *  are reported on `draftConflicts` so the editor can offer the override + the undo. */
  const applyDraft = useCallback(
    (draft: ProfileDraft) => {
      const next = draftFormState(draft);
      const current = stateRef.current;
      const { merged, kept } = mergeDraft(current, baseline, next);
      stateRef.current = merged;
      setState(merged);
      setPending({ before: current, draft: next, kept });
    },
    [baseline]
  );

  /** "Use the draft anyway" — take the last draft whole, keeping the same undo point. */
  const acceptDraftFully = () => {
    if (!pending) return;
    setState(pending.draft);
    setPending({ ...pending, kept: [] });
  };

  /** One-click undo: the form exactly as it stood before the draft was applied. */
  const undoDraft = () => {
    if (!pending) return;
    setState(pending.before);
    setPending(null);
  };

  const dismissDraftNotice = () => setPending(null);

  return {
    ...state,
    ...setters,
    applyDraft,
    acceptDraftFully,
    undoDraft,
    dismissDraftNotice,
    /** Non-null while an applied draft can still be undone. */
    draftApplied: pending !== null,
    /** Fields whose hand-edited value the last draft was NOT allowed to overwrite. */
    draftConflicts: pending?.kept ?? [],
    clearBackup,
  };
}
