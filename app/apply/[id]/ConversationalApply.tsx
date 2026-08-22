"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AiDisclosure } from "@/app/_components/AiDisclosure";
import type { ApplyStep } from "@/app/_lib/apply";
// Imported straight from the registry-free intake module (not the apply.ts
// barrel) so the candidate-facing bundle doesn't pull in the archetype registry.
import {
  APPLY_EMAIL_RE,
  applyDraftFingerprint,
  coerceGithubHandle,
  mergeDraftAnswers,
  nextVisibleStepIndex,
} from "@/app/_lib/apply-intake";
import { ensureApplySession } from "@/app/_lib/apply-session-client";
import { cvAutofill } from "@/app/_lib/cv-autofill";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { Msg } from "./apply-chat-types";
import { ApplyDoneCard } from "./ApplyDoneCard";
import { ApplyErrorBlock } from "./ApplyErrorBlock";
import { ApplyFollowup } from "./ApplyFollowup";
import { ApplyStepControls } from "./ApplyStepControls";
import { clearApplyDraft, draftKey, useApplyDraftPersist, useApplyDraftRestore } from "./use-apply-draft";
import { useApplyFollowup } from "./use-apply-followup";
import { useApplySubmit } from "./use-apply-submit";

// Lead-enrichment prefill (the ?lead= hand-off, resolved server-side by
// page.tsx): the chat opens already knowing the lead instead of greeting them
// as a stranger. `answers` seeds the facts already on file (name/email + the KO
// gates they explicitly passed — page.tsx trims those steps out of the script),
// `greeting` is the localized "Welcome back, {name}" opener, and `leadToken`
// rides the final POST so the merge targets the lead's own entry rather than
// hinging on a re-typed email.
export type ApplyPrefill = {
  leadToken: string;
  answers: Record<string, string | boolean>;
  greeting: string | null;
};

export function ConversationalApply({
  jobId,
  steps,
  prefill,
}: {
  jobId: string;
  steps: ApplyStep[];
  prefill?: ApplyPrefill | null;
}) {

  const t = useTranslations("apply");
  const tCommon = useTranslations("common");
  const errMsg = useErrorMessage();
  // The localStorage slot for this visit — namespaced by the enrichment lead
  // token (see draftKey) so a first-time draft and an enrichment draft for the
  // same job never share a slot. Stable across renders (both are props).
  const draftStorageKey = draftKey(jobId, prefill?.leadToken);
  // The script this visit is actually running. A draft recorded against a
  // different one (job edited, archetype options changed, language switched)
  // cannot be replayed onto it — see applyDraftFingerprint.
  const locale = useLocale();
  const draftFingerprint = applyDraftFingerprint(steps.map((s) => s.id), locale);
  const [idx, setIdx] = useState(0);
  // Seeded from the server-built steps so the first prompt paints on hydration —
  // no initial fetch, no fatal load-error branch, no Loading… flash. The script
  // is fixed for the page's lifetime, so it's a prop rather than fetched state.
  // An enrichment visit opens with the welcome-back bubble before the first
  // remaining question.
  const initialMsgs = (): Msg[] => {
    const first: Msg = { who: "bot", text: steps[0]?.prompt ?? t("letsBegin") };
    return prefill?.greeting ? [{ who: "bot", text: prefill.greeting }, first] : [first];
  };
  const [msgs, setMsgs] = useState<Msg[]>(initialMsgs);
  // Starts from the prefilled facts (empty for a first-time applicant) so the
  // seeded keys ride every advance() merge into the final POST payload.
  const [answers, setAnswers] = useState<Record<string, unknown>>(() => ({ ...(prefill?.answers ?? {}) }));
  const [input, setInput] = useState("");
  // The final POST and its outcome — `done` (accepted / declined, plus the
  // duplicate / enriched nuances), the in-flight flag, and the recoverable
  // failure. See useApplySubmit for why a failure is never terminal.
  const { done, submitting, submitError, submitApplication, retrySubmit, resetSubmit } = useApplySubmit({
    jobId,
    lead: prefill ? prefill.leadToken : null,
    submitFailedMessage: t("submitFailed"),
    networkFailedMessage: t("networkFailed"),
    errMsg,
  });
  // The post-accept gap questions. Purely additive: the application is ALREADY
  // FILED before that block ever renders, so every state there is a courtesy.
  const followup = useApplyFollowup({ jobId, saveFailedMessage: t("followup.saveFailed") });
  // True during the 250ms hand-off between steps; locks the controls so a step
  // can't be answered before the next prompt has even rendered.
  const [transitioning, setTransitioning] = useState(false);
  // CV-upload step: text extraction is in flight, or it failed (recoverable — the
  // candidate can pick another file or skip; the step is optional).
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  // Per-step validation error (currently the email step), shown inline so a typo is fixed
  // in place rather than rejected only at the final submit — which forces a full restart.
  const [stepError, setStepError] = useState<string | null>(null);
  // CV-first autofill (idea-cddec0bf): editable defaults parsed from an uploaded
  // CV, keyed by step id (name/email). Seeded into the text input when the flow
  // reaches that step, so the candidate confirms rather than retypes.
  const [cvDefaults, setCvDefaults] = useState<Record<string, string>>({});
  // True once an in-progress draft has been restored from a prior visit
  // (idea-939d96e9) — surfaces a "we picked up where you left off" banner with a
  // start-fresh escape. `hydratedRef` gates the persist effect so it can't write
  // the empty initial state over a saved draft before the restore effect runs.
  const [resumed, setResumed] = useState(false);
  const hydratedRef = useRef(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  // Step ids already answered — the synchronous guard that makes advance()
  // idempotent even when two events fire within the same render frame.
  const answeredRef = useRef<Set<string>>(new Set());
  const stepTimer = useRef<number | null>(null);
  const stepControlsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, done, submitError]);

  useEffect(() => {
    return () => {
      if (stepTimer.current !== null) window.clearTimeout(stepTimer.current);
    };
  }, []);

  // Restore an in-progress draft once, on mount (idea-939d96e9) — the storage
  // read, the validation and the script-identity check live in useApplyDraft;
  // what to DO with a valid draft stays here, because it is prefill policy.
  useApplyDraftRestore({
    draftStorageKey,
    draftFingerprint,
    stepIds: steps.map((s) => s.id),
    hydratedRef,
    answeredRef,
    onRestore: (d) => {
      // Reconcile the draft with the enrichment prefill: the seeded name/email +
      // passed-KO keys ALWAYS win, so a stale draft can't wipe a returning lead's
      // KO=true and make the server's strict verdict wrongly DECLINE them. With a
      // prefill-less (normal) visit this is the draft's answers verbatim.
      setAnswers(mergeDraftAnswers(d.answers, prefill?.answers));
      setMsgs(d.msgs);
      setIdx(d.idx);
      setResumed(true);
    },
  });

  // Record that this candidate STARTED an application, once per attempt — the
  // apply funnel's denominator, which otherwise does not exist server-side (see
  // apply-session-store.ts). Deliberately its own effect rather than folded into
  // the draft restore above: the draft logic is safety-critical (script
  // fingerprints, KO gates) and measurement must not be able to perturb it.
  useEffect(() => {
    ensureApplySession(jobId, "chat");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only, one start per attempt
  }, []);

  // Persist the draft as the conversation progresses, and clear it (with the
  // attempt) the moment the application completes.
  useApplyDraftPersist({
    jobId,
    draftStorageKey,
    draftFingerprint,
    hydratedRef,
    answeredRef,
    idx,
    answers,
    msgs,
    done,
  });

  // Move focus to the first control of a newly-rendered step so keyboard / screen-reader
  // users don't have to tab from the top of the page on every ko / choice / file step (only
  // the free-text input previously autoFocused). Runs once the step settles (not transitioning)
  // and skips text steps, whose <input autoFocus> already handles it.
  useEffect(() => {
    if (done || submitError || transitioning) return;
    const step = steps[idx];
    if (!step || step.type === "text") return;
    stepControlsRef.current?.querySelector<HTMLElement>("button:not([disabled])")?.focus();
  }, [idx, transitioning, done, submitError, steps]);

  // Seed a CV-parsed value into the text input on arrival at its step
  // (idea-cddec0bf), only when the candidate hasn't already answered it and the
  // box is empty — so it's an editable default, never an overwrite of their typing.
  useEffect(() => {
    if (done || submitError || transitioning) return;
    const step = steps[idx];
    if (!step || step.type !== "text" || answeredRef.current.has(step.id)) return;
    const pf = cvDefaults[step.id];
    if (pf && input.trim() === "") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- seed an editable CV-parsed default
      setInput(pf);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally not on `input`: seed once per step, don't re-seed after the candidate clears it
  }, [idx, transitioning, done, submitError, cvDefaults, steps]);

  // The controls are locked while a POST is in flight or while we're mid-hop
  // between steps. advance() is the single entry point and answers each step
  // exactly once, keyed by step id, so a double-click / double-Enter that slips
  // past the disabled UI (or fires within one render frame) is a no-op.
  const busy = submitting || transitioning;

  // Reset the conversation to its first question, in place, after a NON-retryable
  // failure OR after a DECLINE — the server rejected the captured input (or the
  // candidate mis-tapped a knockout answer), so resending it can't help.
  // Clearing answeredRef and the remembered final answers lets the candidate
  // re-walk every step and submit fresh, valid input, without the full page reload
  // that would otherwise be their only escape from a rejected payload. An
  // enrichment visit restarts to its seeded state (the prefilled facts weren't
  // typed here and aren't what the server rejected).
  const restartConversation = () => {
    if (submitting) return;
    // Cancel any step hand-off still in flight. The resumed-draft banner's
    // "start fresh" is live DURING the 250ms hop, so without this the pending
    // timer fires after the reset and drops the candidate onto the next step
    // with a blank answer set — they then walk only the tail of the script and
    // submit with no name, no email and the knockout gates before it missing.
    if (stepTimer.current !== null) {
      window.clearTimeout(stepTimer.current);
      stepTimer.current = null;
    }
    setTransitioning(false);
    answeredRef.current = new Set();
    clearApplyDraft(draftStorageKey);
    setResumed(false);
    // Drops the remembered final answers, the inline submit error, and — since
    // the decline done-screen offers this same control — a DECLINED outcome, so
    // a mis-tapped knockout on the last step isn't terminal.
    resetSubmit();
    followup.resetGaps();
    setAnswers({ ...(prefill?.answers ?? {}) });
    setInput("");
    setStepError(null);
    // The CV step leads the script, so a stale "couldn't read that file" would
    // otherwise greet the candidate under the very first question of the retry.
    setUploadErr(null);
    setIdx(0);
    setMsgs(initialMsgs());
  };

  const advance = async (stepId: string, newAnswers: Record<string, unknown>, label: string) => {
    if (busy || answeredRef.current.has(stepId)) return;
    answeredRef.current.add(stepId);

    setMsgs((m) => [...m, { who: "me", text: label }]);
    setAnswers(newAnswers);
    // The script carries per-archetype lanes (student / switcher / experienced)
    // as conditional steps — hop to the next step VISIBLE under the answers so
    // far, not blindly to idx + 1.
    const next = nextVisibleStepIndex(steps, idx, newAnswers);
    if (next !== -1) {
      setTransitioning(true);
      stepTimer.current = window.setTimeout(() => {
        stepTimer.current = null;
        setMsgs((m) => [...m, { who: "bot", text: steps[next].prompt }]);
        setIdx(next);
        setTransitioning(false);
      }, 250);
    } else {
      await submitApplication(newAnswers);
    }
  };

  const submitText = () => {
    const v = input.trim();
    if (!v || busy) return;
    const step = steps[idx];
    // Validate the email at its own step (same regex the server uses). The server allows a
    // blank email but rejects a malformed one only at the FINAL submit — a non-retryable 400
    // that forces "Start over" and wipes every answer. Catching it here fixes a typo in place.
    if (step.id === "email" && !APPLY_EMAIL_RE.test(v)) {
      setStepError(t("invalidEmail"));
      return;
    }
    // Validate the GitHub handle at its own step (same shape gate the server
    // persists through). The server never rejects on it — a junk handle is
    // silently DROPPED there — so this inline check is the only place a typo'd
    // handle gets caught; the Skip control stays the escape hatch for "I don't
    // have one".
    if (step.id === "github" && !coerceGithubHandle(v)) {
      setStepError(t("invalidGithub"));
      return;
    }
    setStepError(null);
    advance(step.id, { ...answers, [step.id]: v }, v);
    setInput("");
  };
  const submitKo = (yes: boolean) => {
    if (busy) return;
    const step = steps[idx];
    // capst-l2-101 — the echoed chat bubble must speak the candidate's language,
    // same catalog keys as the buttons themselves ("Ano"/"Ne" in cs).
    advance(step.id, { ...answers, [step.id]: yes }, yes ? tCommon("yes") : tCommon("no"));
  };
  const submitChoice = (value: string, label: string) => {
    if (busy) return;
    const step = steps[idx];
    advance(step.id, { ...answers, [step.id]: value }, label);
  };
  // CV-upload step: extract the file's text via the same /api/extract-text the
  // recruiter Profile form uses (kept as an inline fetch — importing AnalyzeApi
  // would pull schema deps into this lean candidate bundle), then store the text
  // as this step's answer. The step is optional, so any failure is recoverable in
  // place (pick another file / skip) and never blocks the application.
  const uploadCv = async (file: File) => {
    if (busy || uploading) return;
    setUploading(true);
    setUploadErr(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/extract-text", { method: "POST", body: form });
      const d = (await res.json().catch(() => null)) as { text?: string; error?: string } | null;
      if (!res.ok || !d || typeof d.text !== "string" || !d.text.trim()) {
        throw new Error("extract-text failed");
      }
      // Pre-fill the identity steps from the CV so the candidate confirms rather
      // than retypes (idea-cddec0bf). Editable defaults only; never auto-submitted.
      const auto = cvAutofill(d.text);
      if (Object.keys(auto).length > 0) setCvDefaults((p) => ({ ...p, ...auto }));
      const step = steps[idx];
      advance(step.id, { ...answers, [step.id]: d.text }, t("attachedFile", { name: file.name }));
    } catch {
      setUploadErr(t("fileReadFailed"));
    } finally {
      setUploading(false);
    }
  };
  // Skip the current OPTIONAL step (the file step, or an `optional` text step
  // like the GitHub handle): answers "" — which the server reads as "not given"
  // — and moves on.
  const skipStep = () => {
    if (busy || uploading) return;
    const step = steps[idx];
    // Drop any half-typed input and its inline validation error — skipping IS
    // the recovery path for a handle the candidate can't get past the gate.
    setInput("");
    setStepError(null);
    advance(step.id, { ...answers, [step.id]: "" }, t("skippedFile"));
  };

  const cur = !done ? steps[idx] : null;

  return (
    <div>
      {/* idea-939d96e9 — a restored in-progress application: tell the candidate we
          resumed and give a one-tap way to start over. */}
      {resumed && !done ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-stone-200 bg-paper p-2.5">
          <span className="text-base text-steel">{t("resumedNote")}</span>
          <button
            type="button"
            // Discard the restored draft and begin again from the first question
            // (idea-939d96e9) — the escape hatch for a candidate who'd rather start over.
            onClick={restartConversation}
            className="focus-ring rounded-md px-2 py-1 text-base font-semibold text-steel hover:text-ink"
          >
            {t("startFresh")}
          </button>
        </div>
      ) : null}
      {/* role="log" + aria-live so each new bot prompt (and the final outcome) is announced
          to screen readers — the conversation previously advanced visual-only, leaving SR
          users with silence after each answer on this public candidate flow. */}
      <div className="space-y-3" role="log" aria-live="polite">
        {msgs.map((m, i) => (
          <div key={i} className={m.who === "me" ? "text-right" : ""}>
            <span
              className={`inline-block max-w-[85%] rounded-2xl px-3.5 py-2 text-base leading-6 ${
                m.who === "me" ? "bg-coral text-white" : "border border-stone-200 bg-white text-ink"
              }`}
            >
              {m.text}
            </span>
          </div>
        ))}
        {done ? <ApplyDoneCard done={done} onRestart={restartConversation} /> : null}
        <div ref={endRef} />
      </div>

      {done && done.result === "accepted" && done.followupToken && (done.followupGaps?.length ?? 0) > 0 && followup.gapState !== "dismissed" ? (
        <ApplyFollowup
          gaps={done.followupGaps ?? []}
          answers={followup.gapAnswers}
          state={followup.gapState}
          error={followup.gapError}
          onAnswer={followup.setGapAnswer}
          onSubmit={() => void followup.submitGapAnswers(done.followupToken)}
          onDismiss={followup.dismissGaps}
        />
      ) : null}

      {!done && submitError ? (
        <ApplyErrorBlock
          error={submitError}
          submitting={submitting}
          onRetry={retrySubmit}
          onRestart={restartConversation}
        />
      ) : null}

      {!done && cur && !submitError ? (
        <ApplyStepControls
          step={cur}
          controlsRef={stepControlsRef}
          busy={busy}
          uploading={uploading}
          uploadErr={uploadErr}
          input={input}
          stepError={stepError}
          cvPrefilled={Boolean(cvDefaults[cur.id])}
          onInputChange={(value) => {
            setInput(value);
            if (stepError) setStepError(null);
          }}
          onSubmitText={submitText}
          onKo={submitKo}
          onChoice={submitChoice}
          onUpload={(f) => void uploadCv(f)}
          onSkip={skipStep}
        />
      ) : null}

      <AiDisclosure className="mt-6" showDataConsent />
    </div>
  );
}
