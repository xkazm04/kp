"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AiDisclosure } from "@/app/_components/AiDisclosure";
import type { ApplyStep } from "@/app/_lib/apply";
// Imported straight from the registry-free intake module (not the apply.ts
// barrel) so the candidate-facing bundle doesn't pull in the archetype registry.
import { isRetryableApplyStatus, nextVisibleStepIndex } from "@/app/_lib/apply-intake";
import { useErrorMessage } from "@/app/_lib/use-error-message";

type Msg = { who: "bot" | "me"; text: string };

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
  // `duplicate` flags a repeat application (the candidate already applied to this
  // role): the submission is still "accepted" — their first application stands —
  // but we acknowledge it plainly rather than re-celebrating a fresh "You're in".
  // `enriched` is the repeat that REBUILT their profile (e.g. a quick-apply lead
  // following its enrichment link): that one celebrates — they did what we asked.
  const [done, setDone] = useState<{
    result: "accepted" | "declined";
    message: string;
    duplicate?: boolean;
    enriched?: boolean;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // A FAILED final submit — recoverable, rendered inline so the conversation and
  // every captured answer survive a blip on the last step. The recovery ACTION
  // depends on WHY it failed (see isRetryableApplyStatus):
  //   - retryable (network / 5xx / 408 / 429): a "Try again" that re-POSTs the
  //     already-collected answers — the candidate never re-walks the chat.
  //   - not retryable (the server rejected the input — e.g. an answer too long, a
  //     payload too large): re-POSTing the identical payload would fail the same
  //     way forever, so the only honest path is a "Start over" that resets to the
  //     first question in place (no full page reload).
  // (There is no longer a fatal load-error state: the script arrives as a prop,
  // server-built.)
  const [submitError, setSubmitError] = useState<{ message: string; retryable: boolean } | null>(null);
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
  const endRef = useRef<HTMLDivElement | null>(null);
  // Step ids already answered — the synchronous guard that makes advance()
  // idempotent even when two events fire within the same render frame.
  const answeredRef = useRef<Set<string>>(new Set());
  // The fully-collected answers from the final step, kept so "Try again" can
  // re-submit them directly — bypassing advance()'s answeredRef guard, which has
  // already marked the final step answered and would otherwise block a resend.
  const finalAnswersRef = useRef<Record<string, unknown> | null>(null);
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

  // The controls are locked while a POST is in flight or while we're mid-hop
  // between steps. advance() is the single entry point and answers each step
  // exactly once, keyed by step id, so a double-click / double-Enter that slips
  // past the disabled UI (or fires within one render frame) is a no-op.
  const busy = submitting || transitioning;

  // POST the completed application. Failures set `submitError` — rendered inline,
  // recoverable — so a transient last-step blip never destroys the conversation.
  // `finalAnswers` is remembered so "Try again" can re-POST the same payload
  // without re-walking the chat.
  const submitApplication = async (finalAnswers: Record<string, unknown>) => {
    finalAnswersRef.current = finalAnswers;
    // Don't clear submitError up front: on a retry that keeps the inline error
    // block (now showing "Sending…") in place instead of flashing the answered
    // step's disabled controls. A success swaps in `done`; a failure overwrites it.
    setSubmitting(true);
    try {
      const res = await fetch(`/api/apply/${jobId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The lead token (when this is an enrichment visit) targets the merge at
        // the lead's own entry server-side; the server re-validates it and falls
        // back to email/name identity when it's absent or stale.
        body: JSON.stringify(
          prefill ? { answers: finalAnswers, lead: prefill.leadToken } : { answers: finalAnswers }
        ),
      });
      const d = await res.json();
      if (res.ok) {
        setDone({ result: d.result, message: d.message, duplicate: Boolean(d.duplicate), enriched: Boolean(d.enriched) });
      } else {
        // The server rejected the submit. isRetryableApplyStatus decides whether a
        // re-POST of the same answers could succeed (5xx / transient) or is futile
        // (4xx — the input itself was rejected), which selects Try-again vs Start-over.
        setSubmitError({
          message: errMsg(d, t("submitFailed")),
          retryable: isRetryableApplyStatus(res.status),
        });
      }
    } catch {
      // No HTTP response at all (offline / network blip) — always retryable.
      setSubmitError({
        message: t("networkFailed"),
        retryable: true,
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Re-POST the already-collected final answers after a RETRYABLE failure. Goes
  // straight to submitApplication (not advance), since the final step is already
  // in answeredRef and advance() would no-op.
  const retrySubmit = () => {
    if (submitting || !finalAnswersRef.current) return;
    submitApplication(finalAnswersRef.current);
  };

  // Reset the conversation to its first question, in place, after a NON-retryable
  // failure — the server rejected the captured input, so resending it can't help.
  // Clearing answeredRef and the remembered final answers lets the candidate
  // re-walk every step and submit fresh, valid input, without the full page reload
  // that would otherwise be their only escape from a rejected payload. An
  // enrichment visit restarts to its seeded state (the prefilled facts weren't
  // typed here and aren't what the server rejected).
  const restartConversation = () => {
    if (submitting) return;
    answeredRef.current = new Set();
    finalAnswersRef.current = null;
    setSubmitError(null);
    setAnswers({ ...(prefill?.answers ?? {}) });
    setInput("");
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
    if (step.id === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      setStepError(t("invalidEmail"));
      return;
    }
    setStepError(null);
    advance(step.id, { ...answers, [step.id]: v }, v);
    setInput("");
  };
  const submitKo = (yes: boolean) => {
    if (busy) return;
    const step = steps[idx];
    advance(step.id, { ...answers, [step.id]: yes }, yes ? "Yes" : "No");
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
      const step = steps[idx];
      advance(step.id, { ...answers, [step.id]: d.text }, t("attachedFile", { name: file.name }));
    } catch {
      setUploadErr(t("fileReadFailed"));
    } finally {
      setUploading(false);
    }
  };
  const skipFile = () => {
    if (busy || uploading) return;
    const step = steps[idx];
    advance(step.id, { ...answers, [step.id]: "" }, t("skippedFile"));
  };

  const cur = !done ? steps[idx] : null;

  return (
    <div>
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
        {done ? (
          // A fresh acceptance celebrates (moss), and so does an enriching
          // repeat (their profile just got completed); a plain repeat and a
          // decline both render neutrally — a repeat isn't a new win, and a
          // decline shouldn't read as one.
          <div className={`rounded-lg border p-4 ${done.result === "accepted" && (!done.duplicate || done.enriched) ? "border-moss/40 bg-moss/5" : "border-stone-200 bg-paper"}`}>
            <p className={`font-serif text-h3 ${done.result === "accepted" && (!done.duplicate || done.enriched) ? "text-moss" : "text-ink"}`}>
              {done.result === "accepted"
                ? done.enriched
                  ? t("profileCompleted")
                  : done.duplicate
                    ? t("alreadyApplied")
                    : t("youreIn")
                : t("thanksApplying")}
            </p>
            <p className="mt-1 text-base text-steel">{done.message}</p>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      {!done && submitError ? (
        // A failed final submit. The conversation and every captured answer above
        // stay intact; the recovery action matches WHY it failed (see the
        // submitError contract above): a transient blip re-POSTs the same answers,
        // while a server-rejected input restarts so the candidate can fix it.
        <div className="mt-4 rounded-lg border border-coral/40 bg-coral/5 p-4">
          <p className="text-base text-coral">{submitError.message}</p>
          {submitError.retryable ? (
            <button
              type="button"
              disabled={submitting}
              onClick={retrySubmit}
              className="focus-ring mt-3 rounded-md bg-ink px-4 py-2 text-base font-semibold text-white hover:bg-steel disabled:opacity-50"
            >
              {submitting ? t("sending") : tCommon("retry")}
            </button>
          ) : (
            <button
              type="button"
              onClick={restartConversation}
              className="focus-ring mt-3 rounded-md bg-ink px-4 py-2 text-base font-semibold text-white hover:bg-steel"
            >
              {t("startOver")}
            </button>
          )}
        </div>
      ) : null}

      {!done && cur && !submitError ? (
        <div className="mt-4" ref={stepControlsRef}>
          {cur.type === "ko" ? (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => submitKo(true)}
                className="focus-ring rounded-md border border-stone-200 bg-white px-5 py-2 text-base font-semibold text-ink hover:border-moss/50 disabled:opacity-50"
              >
                {tCommon("yes")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => submitKo(false)}
                className="focus-ring rounded-md border border-stone-200 bg-white px-5 py-2 text-base font-semibold text-ink hover:border-coral/50 disabled:opacity-50"
              >
                {tCommon("no")}
              </button>
            </div>
          ) : cur.type === "choice" ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {(cur.options ?? []).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={busy}
                  onClick={() => submitChoice(opt.value, opt.label)}
                  className="focus-ring rounded-md border border-stone-200 bg-white px-4 py-2 text-left text-base font-semibold text-ink hover:border-coral/50 disabled:opacity-50"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          ) : cur.type === "file" ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <label
                  className={`focus-ring inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-stone-200 bg-white px-4 py-2 text-base font-semibold text-ink hover:border-coral/50 ${
                    busy || uploading ? "pointer-events-none opacity-50" : ""
                  }`}
                >
                  {uploading ? t("reading") : t("attachCv")}
                  <input
                    type="file"
                    accept=".pdf,.docx,.doc,.txt,.md,application/pdf"
                    disabled={busy || uploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.currentTarget.value = ""; // allow re-picking the same file after an error
                      if (f) void uploadCv(f);
                    }}
                    className="sr-only"
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || uploading}
                  onClick={skipFile}
                  className="focus-ring rounded-md px-3 py-2 text-base font-semibold text-steel hover:text-ink disabled:opacity-50"
                >
                  {t("skip")}
                </button>
              </div>
              {uploadErr ? <p role="alert" className="text-sm text-coral">{uploadErr}</p> : null}
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitText();
              }}
              className="flex gap-2"
            >
              <input
                autoFocus
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  if (stepError) setStepError(null);
                }}
                placeholder={cur.placeholder}
                disabled={busy}
                aria-invalid={stepError ? true : undefined}
                className="focus-ring h-11 flex-1 rounded-md border border-stone-200 px-3 text-base disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!input.trim() || busy}
                className="focus-ring rounded-md bg-ink px-4 text-base font-semibold text-white hover:bg-steel disabled:opacity-50"
              >
                {t("send")}
              </button>
            </form>
          )}
          {stepError ? <p role="alert" className="mt-1.5 text-sm text-coral">{stepError}</p> : null}
        </div>
      ) : null}

      <AiDisclosure className="mt-6" />
    </div>
  );
}
