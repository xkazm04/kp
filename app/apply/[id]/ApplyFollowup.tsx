"use client";

import { useTranslations } from "next-intl";
import { TextArea } from "@/app/_components/TextArea";
import { TextInput } from "@/app/_components/TextInput";
import { gapFieldCopy, type CompletenessGap } from "@/app/_lib/completeness-followup";
import type { ApplyFollowupState } from "./use-apply-followup";

/**
 * The post-accept profile-gap follow-up. profile_cli reports which archetype
 * checklist items a built profile still misses on EVERY apply; the recruiter
 * could always fill them in, but the one person who knows the answers — the
 * candidate, standing right here — was never asked. Strictly optional and
 * strictly after the fact: the application is filed, the "You're in" card is
 * already above this, and Skip/close costs nothing.
 */
export function ApplyFollowup({
  gaps,
  answers,
  state,
  error,
  onAnswer,
  onSubmit,
  onDismiss,
}: {
  gaps: CompletenessGap[];
  answers: Record<string, string>;
  state: ApplyFollowupState;
  error: string | null;
  onAnswer: (check: string, value: string) => void;
  onSubmit: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations("apply");
  // The shared gap-question catalog (also read by the recruiter's ArchetypeBanner)
  // — injected into the pure completeness-followup module, never imported by it.
  const tGap = useTranslations("apply.gapFields");

  return (
    <div className="mt-4 rounded-lg border border-stone-200 bg-paper p-4">
      {state === "sent" ? (
        <p role="status" className="text-base text-steel">
          {t("followup.thanks")}
        </p>
      ) : (
        <>
          <p className="font-serif text-h3 text-ink">{t("followup.title")}</p>
          <p className="mt-1 text-sm text-steel">{t("followup.subtitle")}</p>
          <div className="mt-3 space-y-3">
            {gaps.map((gap) => {
              const field = gapFieldCopy(gap.check, tGap);
              // An unknown/new checklist id has no question here — the server
              // already filters, this is the belt-and-braces half.
              if (!field) return null;
              const shared = {
                value: answers[gap.check] ?? "",
                onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                  onAnswer(gap.check, e.target.value),
                placeholder: field.placeholder,
                disabled: state === "sending",
              };
              return (
                <label key={gap.check} className="block text-base text-ink">
                  <span className="text-steel">{field.prompt}</span>
                  {field.multiline ? (
                    <TextArea {...shared} rows={2} className="mt-1" />
                  ) : (
                    <TextInput {...shared} className="mt-1" />
                  )}
                </label>
              );
            })}
          </div>
          {error ? (
            <p role="alert" className="mt-2 text-sm text-coral">
              {error}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={state === "sending"}
              onClick={onSubmit}
              className="focus-ring rounded-md bg-ink px-4 py-2 text-base font-semibold text-white hover:bg-steel disabled:opacity-50"
            >
              {state === "sending" ? t("sending") : t("followup.submit")}
            </button>
            {/* The escape hatch, always available and never destructive. */}
            <button
              type="button"
              disabled={state === "sending"}
              onClick={onDismiss}
              className="focus-ring rounded-md px-3 py-2 text-base font-semibold text-steel hover:text-ink disabled:opacity-50"
            >
              {t("followup.skip")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
