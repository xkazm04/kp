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
import type { EditorPending, RebuildSeed } from "./profileRebuildMerge";
import { backupSlot, makeEnvelope, planRestore } from "./profileEditorBackup";

/** The pending change the banner offers to keep / override / undo. A restored backup
 *  rides the same machinery as an AI draft and a rebuild, tagged so the banner can word
 *  it ("your unsaved edits from …") and so the backup writer knows an undecided restore
 *  must not be overwritten. */
export type FieldsPending = Omit<EditorPending, "origin"> & {
  origin?: EditorPending["origin"] | "restore";
  /** A restore: when the backup was written (ISO), null for a pre-envelope backup. */
  restoredFrom?: string | null;
  /** A restore: the backup carried no version, so it was only OFFERED, not applied. */
  offered?: boolean;
};

/** Who is being edited, and against which stored version — the backup's identity. */
export type EditorIdentity = {
  editingId: string | null;
  sourceAnalysisSlug?: string | null;
  /** The row's updated_at as this editor loaded it (null for a create). */
  initialUpdatedAt?: string | null;
};

// sessionStorage (not localStorage) on purpose: an abandoned intake should not
// outlive the tab, and a second tab editing a DIFFERENT profile must not inherit
// this one's draft. The slot is one per editing IDENTITY (profileEditorBackup.backupSlot:
// row id + the analysis it was opened from) and holds a versioned envelope, restored
// three-way by planRestore — never spread blind over what the editor just loaded.

/**
 * Merge a pre-envelope (bare-form) backup over the form state it should restore INTO.
 * Since the versioned envelope this is only ever OFFERED, never applied on mount —
 * planRestore's `offer` is exactly this spread (profileEditorBackup.test.ts case 6).
 *
 * Spread, never replace: a backup written by an older build can be missing fields
 * this one has, and a partial restore must not blank them. Anything unusable — no
 * backup, unparseable JSON, a stored `null`, an array, a primitive — returns the
 * SAME state object, so a corrupt slot costs the safety net and never the edit in
 * front of the recruiter. Pure, and exported, so both halves are pinned at runtime
 * (useProfileEditorFields.test.ts) instead of only inside an effect.
 */
export function applyBackup(state: ProfileFormState, raw: string | null | undefined): ProfileFormState {
  if (!raw) return state;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* best-effort: a truncated or hand-edited slot is not a restorable intake —
       the recruiter simply starts from the payload the editor loaded with. */
    return state;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return state;
  return { ...state, ...(parsed as Partial<ProfileFormState>) };
}

// hydrate() maps a stored payload (edit/duplicate) — or null (blank create) — into form
// state honestly: it never pre-fills education/languages/seniority the candidate didn't
// declare, so a blank intake's completeness reflects real input rather than unchosen
// defaults (idea-fa7d5360). Create and edit are identical. Exported for the rebuild
// merge (profileRebuildMerge.ts), which must map its three payloads the same way.
export function formStateFrom(payload: ProfilePayload | null, archetype?: string): ProfileFormState {
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

export function useProfileEditorFields(
  initialPayload: ProfilePayload | null,
  { editingId, sourceAnalysisSlug = null, initialUpdatedAt = null }: EditorIdentity,
  // A rebuild from a newer CV opens ON its merge (profileRebuildMerge.rebuildEditorState)
  // with the rebuild already pending, so the banner offers the per-field override and
  // Undo. Omitted: the editor loads `initialPayload` exactly as before.
  seed: RebuildSeed | null = null
) {
  // The values this editing session LOADED with. mergeDraft compares against them to
  // tell "the recruiter typed this" from "this is just what the profile already said".
  // Held in state (not a ref) so the lazy initializer runs exactly once — hydrate()
  // mints fresh row `_id`s on every call and a per-render baseline would report every
  // row list as hand-edited.
  const [baseline] = useState<ProfileFormState>(() => seed?.state ?? formStateFrom(initialPayload));
  const [state, setState] = useState<ProfileFormState>(baseline);

  // The form as it stood immediately BEFORE the last applied draft, and the fields that
  // draft was refused. Together they are the undo + the "use the draft anyway" offer.
  const [pending, setPending] = useState<FieldsPending | null>(seed?.pending ?? null);

  const backupKey = backupSlot({ editingId, sourceAnalysisSlug });
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
      let raw: string | null = null;
      try {
        raw = window.sessionStorage.getItem(backupKey);
      } catch {
        /* best-effort: a private window, a full quota or a disabled store must never
           stop the editor from opening — the recruiter simply starts from the payload. */
      }
      // planRestore decides what the slot may do to the form this session LOADED; it
      // never touches the live state, so the plan is computed outside the updater.
      const plan = planRestore(raw, { baseVersion: initialUpdatedAt, loaded: baseline });
      if (plan.kind === "silent") {
        // Nothing moved since the backup was written: exactly the old behaviour.
        setState(plan.state);
      } else if (plan.kind === "moved") {
        // The row changed since: open on the merge, the banner names what was held back,
        // "use mine anyway" takes the recruiter's contested values, Undo drops the restore.
        setState(plan.merged);
        setPending({ before: baseline, draft: plan.mine, kept: plan.contested, origin: "restore", restoredFrom: plan.savedAt || null });
      } else if (plan.kind === "offer") {
        // No version on the backup: offer it, never apply it.
        setPending({ before: baseline, draft: plan.state, kept: plan.fields, origin: "restore", restoredFrom: null, offered: true });
      } else if (plan.remove) {
        try {
          window.sessionStorage.removeItem(backupKey);
        } catch {
          /* best-effort: an unreadable slot left behind is overwritten by the next edit
             and dies with the tab. */
        }
      }
      restored.current = true;
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // baseline/initialUpdatedAt are fixed for the editor's life (the editor remounts per
    // profile), so the restore runs once per slot.
  }, [backupKey, baseline, initialUpdatedAt]);

  // An undecided restore still holds values that exist ONLY in the old backup (the
  // contested fields, or an offered legacy form). Writing a fresh envelope now would
  // silently delete them, so the slot is left alone until the recruiter chooses.
  const holdBackup = pending?.origin === "restore" && pending.kept.length > 0;

  // Back it up on every change once the restore has settled: a versioned envelope, so
  // the next open can tell an unchanged row (silent restore) from a moved one (ask).
  useEffect(() => {
    if (!restored.current || holdBackup) return;
    try {
      window.sessionStorage.setItem(
        backupKey,
        JSON.stringify(makeEnvelope({ baseVersion: initialUpdatedAt, baseline, draft: state, savedAt: new Date().toISOString() }))
      );
    } catch {
      /* best-effort: quota/private-mode failures cost the recruiter the safety net,
         never the edit in front of them. */
    }
  }, [backupKey, state, baseline, initialUpdatedAt, holdBackup]);

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
      setPending({ before: current, draft: next, kept, origin: "draft" });
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
    /** What the pending change came from — the banner words a rebuild differently. */
    draftOrigin: pending?.origin ?? "draft",
    /** A restored backup: when it was written (ISO), and whether it was only offered. */
    restoredFrom: pending?.origin === "restore" ? (pending.restoredFrom ?? null) : null,
    restoreOffered: pending?.origin === "restore" && pending.offered === true,
    clearBackup,
  };
}
