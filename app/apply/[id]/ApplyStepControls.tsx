"use client";

import { useTranslations } from "next-intl";
import type { RefObject } from "react";
import { TextInput } from "@/app/_components/TextInput";
import type { ApplyStep } from "@/app/_lib/apply";
// The SAME accept list the recruiter-side drop zones render — and the same one
// the server gate (validateUploadServer) and the Python extractor enforce. This
// picker used to hardcode a wider literal that included `.doc`, which nothing
// downstream can read: legacy Word was offered by the picker and then refused
// with a 400 AFTER the upload, on a public flow with no support channel.
import { ACCEPT_EXTENSIONS } from "@/app/_lib/upload-constraints";

/**
 * The controls for the step the conversation is currently on — one branch per
 * step type (ko / choice / file / free text), plus the inline per-step
 * validation error and the CV-prefill hint that sit under them.
 *
 * Presentational: every answer leaves through one of the callbacks and reaches
 * the chat's single advance() entry point, so the double-answer guards stay in
 * one place. `busy` is the same lock the chat computes (a POST in flight or a
 * mid-step hop).
 */
export function ApplyStepControls({
  step,
  controlsRef,
  busy,
  uploading,
  uploadErr,
  input,
  stepError,
  cvPrefilled,
  onInputChange,
  onSubmitText,
  onKo,
  onChoice,
  onUpload,
  onSkip,
}: {
  step: ApplyStep;
  controlsRef: RefObject<HTMLDivElement | null>;
  busy: boolean;
  uploading: boolean;
  uploadErr: string | null;
  input: string;
  stepError: string | null;
  cvPrefilled: boolean;
  onInputChange: (value: string) => void;
  onSubmitText: () => void;
  onKo: (yes: boolean) => void;
  onChoice: (value: string, label: string) => void;
  onUpload: (file: File) => void;
  onSkip: () => void;
}) {
  const t = useTranslations("apply");
  const tCommon = useTranslations("common");

  return (
    <div className="mt-4" ref={controlsRef}>
      {step.type === "ko" ? (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onKo(true)}
            // NEUTRAL hover, deliberately the same coral affordance as No (and
            // as the choice/quick-form buttons). Yes used to glow moss —
            // the success tone — which on a KNOCKOUT question told the
            // candidate which answer "passes" the eligibility gate before
            // they answered it. moss stays reserved for OUTCOMES (the
            // "You're in" card), never for steering an answer.
            className="focus-ring rounded-md border border-stone-200 bg-white px-5 py-2 text-base font-semibold text-ink hover:border-coral/50 disabled:opacity-50"
          >
            {tCommon("yes")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onKo(false)}
            className="focus-ring rounded-md border border-stone-200 bg-white px-5 py-2 text-base font-semibold text-ink hover:border-coral/50 disabled:opacity-50"
          >
            {tCommon("no")}
          </button>
        </div>
      ) : step.type === "choice" ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {(step.options ?? []).map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={busy}
              onClick={() => onChoice(opt.value, opt.label)}
              className="focus-ring rounded-md border border-stone-200 bg-white px-4 py-2 text-left text-base font-semibold text-ink hover:border-coral/50 disabled:opacity-50"
            >
              {opt.label}
            </button>
          ))}
        </div>
      ) : step.type === "file" ? (
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
                accept={ACCEPT_EXTENSIONS}
                disabled={busy || uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.currentTarget.value = ""; // allow re-picking the same file after an error
                  if (f) onUpload(f);
                }}
                className="sr-only"
              />
            </label>
            <button
              type="button"
              disabled={busy || uploading}
              onClick={onSkip}
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
            onSubmitText();
          }}
          className="flex gap-2"
        >
          <TextInput
            autoFocus
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            placeholder={step.placeholder}
            disabled={busy}
            invalid={Boolean(stepError)}
            className="h-11 flex-1"
          />
          <button
            type="submit"
            disabled={!input.trim() || busy}
            className="focus-ring rounded-md bg-ink px-4 text-base font-semibold text-white hover:bg-steel disabled:opacity-50"
          >
            {t("send")}
          </button>
          {step.optional ? (
            // Same skip affordance as the file step — an optional text step
            // (the GitHub handle) must never gate the application.
            <button
              type="button"
              disabled={busy}
              onClick={onSkip}
              className="focus-ring rounded-md px-3 py-2 text-base font-semibold text-steel hover:text-ink disabled:opacity-50"
            >
              {t("skip")}
            </button>
          ) : null}
        </form>
      )}
      {/* idea-cddec0bf — flag a value pre-filled from the CV so the candidate
          knows to check it rather than assuming they typed it. */}
      {step.type === "text" && cvPrefilled && !stepError ? (
        <p className="mt-1.5 text-sm text-steel">{t("prefilledHint")}</p>
      ) : null}
      {stepError ? <p role="alert" className="mt-1.5 text-sm text-coral">{stepError}</p> : null}
    </div>
  );
}
