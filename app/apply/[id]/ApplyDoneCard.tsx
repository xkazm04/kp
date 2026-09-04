"use client";

import { useTranslations } from "next-intl";
import { BTN_PRIMARY, BTN_SECONDARY } from "@/app/_components/ui/recipes";
import type { ApplyOutcome } from "./apply-chat-types";

/** The outcome card that closes the conversation — the last bubble in the
 *  transcript's aria-live log, so a screen reader announces the verdict the same
 *  way it announced every prompt. */
export function ApplyDoneCard({ done, onRestart }: { done: ApplyOutcome; onRestart: () => void }) {
  const t = useTranslations("apply");

  return (
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
      {/* idea-e76a6fb2 — a tokenized link so the applicant can track their
          status instead of going dark after applying. */}
      {done.result === "accepted" && done.statusToken ? (
        <a
          href={`/status/${done.statusToken}`}
          className={`${BTN_SECONDARY} mt-3 gap-1.5 bg-white px-3 py-1.5 text-base font-semibold`}
        >
          {t("trackStatus")}
        </a>
      ) : null}
      {/* A decline used to be UNRECOVERABLE: `done` is set, the step
          controls unmount, and the persist effect has already deleted the
          draft — so a candidate who mis-tapped "No" on the last question
          of an 8–11 step chat had no way back except finding the URL
          again. Same start-over machinery the non-retryable submit
          failure uses; the note is honest that the answers are gone. */}
      {done.result === "declined" ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={onRestart}
            className={`${BTN_PRIMARY} px-4 py-2 text-base font-semibold`}
          >
            {t("startOver")}
          </button>
          <p className="mt-1.5 text-sm text-steel">{t("declinedRestartNote")}</p>
        </div>
      ) : null}
    </div>
  );
}
