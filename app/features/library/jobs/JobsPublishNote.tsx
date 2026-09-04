"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { PublishNote, PublishSentence } from "./jobsPublishResult";

// The publish result, told as distinct sentences (jobsPublishResult.ts selects
// them). Shared by both surfaces that call /publish — the Drafts panel and the
// job modal's footer — so "what going live did" reads the same in both places.

/** The sentence-to-copy mapping, exported so a caller that cannot RENDER the note
 *  (the Drafts panel's toast, which has to outlive the panel — see there) says the
 *  same words this component does. */
export function usePublishSentenceText(): (s: PublishSentence) => string {
  // Same namespace both callers already use for the publish action's vocabulary —
  // the Drafts panel's strings ARE the modal's ("Source into Pipeline" is one verb
  // on two surfaces), so the result sentences belong beside them.
  const t = useTranslations("jobs.drafts");
  // An explicit switch rather than `t(s.key, { count })`: next-intl's keys are
  // typed per message, and three of these take no argument at all.
  return (s: PublishSentence) => {
    const count = s.count ?? 0;
    switch (s.key) {
      case "wentLive":
        return t("publishWentLive");
      case "alreadyLive":
        return t("publishAlreadyLive");
      case "sourcingFailed":
        return t("publishSourcingFailed");
      case "reopened":
        return t("publishReopened", { count });
      case "sourced":
        return t("publishSourced", { count });
      case "skipped":
        return t("publishSkipped", { count });
      case "silverMedalists":
        return t("publishSilver", { count });
      case "silverMedalistsFailed":
        return t("publishSilverFailed");
    }
  };
}

export function PublishSentences({
  note,
  stale = false,
  className = "",
}: {
  note: PublishNote;
  /** True when this is a result restored from an earlier publish in this session
   *  (the modal was closed and reopened) — labelled as such, because a past run
   *  presented as a fresh one is the dishonesty this surface is fixing. */
  stale?: boolean;
  className?: string;
}) {
  const t = useTranslations("jobs.drafts");
  const say = usePublishSentenceText();
  return (
    <span
      aria-live="polite"
      className={`min-w-0 text-sm ${note.tone === "warn" ? "text-amber-800" : "text-steel"} ${className}`}
    >
      {stale ? <span className="mr-1 font-semibold uppercase text-micro">{t("publishLastResult")}</span> : null}
      {note.sentences.map((s) => say(s)).join(" ")}
    </span>
  );
}

// Publishing spawns a sourcing child and a rediscovery fan-out that can run for
// minutes behind a disabled button, with nothing said. This is the TaskFlightNote
// shape for a call that is NOT a background task: a live region naming the wait
// plus a way out of it. Leaving is honest about what it does and does not undo —
// the route threads the request's AbortSignal into the sourcing child, and the
// go-live transaction commits BEFORE sourcing starts.
export function PublishFlightNote({ onStop, className = "" }: { onStop: () => void; className?: string }) {
  const t = useTranslations("jobs.drafts");
  return (
    <span role="status" className={`inline-flex min-w-0 items-center gap-1.5 text-sm text-steel ${className}`}>
      <Loader2 size={13} className="shrink-0 animate-spin text-coral" aria-hidden />
      <span className="min-w-0">{t("publishInFlight")}</span>
      <button type="button" onClick={onStop} className="focus-ring shrink-0 font-semibold underline hover:text-ink">
        {t("publishStopWaiting")}
      </button>
    </span>
  );
}
