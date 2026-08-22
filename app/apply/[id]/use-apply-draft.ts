"use client";

import { useEffect, type RefObject } from "react";
import { clearApplySession } from "@/app/_lib/apply-session-client";
import type { ApplyOutcome, Msg } from "./apply-chat-types";

// Where in-progress answers are stashed (idea-939d96e9) so a refresh / lost
// signal / return-later resumes mid-chat instead of restarting. Keyed by jobId
// because a candidate may be partway through more than one role's application —
// AND namespaced by the enrichment lead token when present, so a first-time
// attempt's draft (keyed on jobId alone) can never be read on a later ?lead=
// enrichment visit, whose chat runs a different, shorter (KO-trimmed) script.
// Without this the stale first-time draft would clobber the seeded KO=true
// answers and the server would wrongly DECLINE an already-qualified lead.
export const draftKey = (jobId: string, leadToken?: string | null) =>
  leadToken ? `kp:apply-draft:${jobId}:${leadToken}` : `kp:apply-draft:${jobId}`;

// `fp` pins the SCRIPT the draft was recorded against (applyDraftFingerprint:
// step ids + locale). Optional in the type because drafts saved before this
// field existed are still in candidates' browsers — they're treated as a
// mismatch and discarded, which is the same safe path a genuine desync takes.
export type ApplyDraft = { idx: number; answers: Record<string, unknown>; msgs: Msg[]; answeredIds: string[]; fp?: string };

/** What a validated draft hands back to the chat. The caller decides how to
 *  apply it — notably how the enrichment prefill beats the draft's own answers,
 *  which is prefill policy, not storage policy. */
export type RestoredApplyDraft = { idx: number; answers: Record<string, unknown>; msgs: Msg[] };

/**
 * The answered-step ids a RESTORED draft resumes with.
 *
 * A draft is written the instant an answer lands — including the answer to the
 * LAST step, which `advance()` marks answered *before* awaiting the final POST,
 * while `idx` still points at it (there is no next step to hop to). So a draft
 * saved at that moment — the final POST failed, or the tab/signal died
 * mid-request — comes back with `idx` on a step its own `answeredIds` already
 * contains. Restored verbatim, the chat renders that step's controls while
 * advance()'s idempotence guard silently swallows every answer: on the real
 * script the last step is a KNOCKOUT question, so the returning candidate taps
 * Yes/No forever with nothing happening, and their only escape is "start fresh"
 * — which discards all 8–11 answers.
 *
 * So the step being resumed ON is always dropped: whatever the chat shows
 * controls for must be answerable. Re-answering it just overwrites that one
 * answer and moves on, and every EARLIER step stays guarded. Applied on READ
 * rather than on write, so the poisoned drafts already sitting in candidates'
 * browsers are healed too (same reasoning as the optional `fp` field).
 */
export function resumableAnsweredIds(answeredIds: unknown, resumeStepId: string | undefined): Set<string> {
  const ids = Array.isArray(answeredIds) ? answeredIds.filter((v): v is string => typeof v === "string") : [];
  const set = new Set(ids);
  if (resumeStepId !== undefined) set.delete(resumeStepId);
  return set;
}

// Restore an in-progress draft once, on mount (idea-939d96e9). Client-only
// (localStorage), so it runs in an effect — not the initial state — to keep
// hydration matching the server's empty render. Guarded against corrupt/stale
// drafts and never restores a completed flow. `hydratedRef` then unlocks persist.
export function useApplyDraftRestore({
  draftStorageKey,
  draftFingerprint,
  stepIds,
  hydratedRef,
  answeredRef,
  onRestore,
}: {
  draftStorageKey: string;
  draftFingerprint: string;
  /** This visit's script, in order — the bounds check for `idx` AND the id of
   *  the step the draft resumes on (see resumableAnsweredIds). */
  stepIds: string[];
  hydratedRef: RefObject<boolean>;
  answeredRef: RefObject<Set<string>>;
  onRestore: (draft: RestoredApplyDraft) => void;
}) {
  useEffect(() => {
    hydratedRef.current = true;
    try {
      const raw = window.localStorage.getItem(draftStorageKey);
      if (!raw) return;
      const d = JSON.parse(raw) as ApplyDraft;
      if (!d || typeof d.idx !== "number" || d.idx < 0 || d.idx >= stepIds.length) return;
      // Script identity, not just a bounds check: `idx` and the answer keys are
      // only meaningful against the script that recorded them. A mismatch (or a
      // pre-fingerprint draft) is discarded outright — replaying it would put the
      // candidate on a different question than their transcript shows and could
      // skip a KO gate positionally, declining someone who actually qualifies.
      if (d.fp !== draftFingerprint) {
        window.localStorage.removeItem(draftStorageKey);
        return;
      }
      if (!d.answers || typeof d.answers !== "object" || !Array.isArray(d.msgs) || d.msgs.length === 0) return;
      if (Object.keys(d.answers).length === 0) return;
      answeredRef.current = resumableAnsweredIds(d.answeredIds, stepIds[d.idx]);
      onRestore({ idx: d.idx, answers: d.answers, msgs: d.msgs });
    } catch {
      /* corrupt draft — ignore and start fresh */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only restore
  }, []);
}

// Persist the draft as the conversation progresses, and clear it the moment the
// application completes. Gated on hydration so it can't write the empty initial
// state over a saved draft before the restore effect above has run.
export function useApplyDraftPersist({
  jobId,
  draftStorageKey,
  draftFingerprint,
  hydratedRef,
  answeredRef,
  idx,
  answers,
  msgs,
  done,
}: {
  jobId: string;
  draftStorageKey: string;
  draftFingerprint: string;
  hydratedRef: RefObject<boolean>;
  answeredRef: RefObject<Set<string>>;
  idx: number;
  answers: Record<string, unknown>;
  msgs: Msg[];
  done: ApplyOutcome | null;
}) {
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (done) {
      try {
        window.localStorage.removeItem(draftStorageKey);
      } catch {
        /* best-effort */
      }
      // Retire the attempt too: it has been filed and linked, so a later
      // re-application to this role must count as a fresh start.
      clearApplySession(jobId, "chat");
      return;
    }
    if (Object.keys(answers).length === 0) return; // nothing worth saving yet
    try {
      const draft: ApplyDraft = { idx, answers, msgs, answeredIds: [...answeredRef.current], fp: draftFingerprint };
      window.localStorage.setItem(draftStorageKey, JSON.stringify(draft));
    } catch {
      /* quota / unavailable — best-effort */
    }
    // `hydratedRef` / `answeredRef` join the original dep list only because they
    // now arrive as parameters; a useRef box is identity-stable, so the effect
    // fires on exactly the same renders it always did.
  }, [idx, answers, msgs, done, draftStorageKey, draftFingerprint, jobId, hydratedRef, answeredRef]);
}

/** Drop the stored draft — the start-over path, which must not leave a draft
 *  behind that the next mount would restore. Best-effort, like every other write
 *  here: a blocked localStorage must never break the chat. */
export function clearApplyDraft(draftStorageKey: string) {
  try {
    window.localStorage.removeItem(draftStorageKey);
  } catch {
    /* best-effort */
  }
}
