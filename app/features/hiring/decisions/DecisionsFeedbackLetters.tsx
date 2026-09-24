"use client";

// The FEEDBACK-REQUESTS queue in the Decisions tab (spark interview-feedback-letter,
// WP-beta): candidates who asked, from their own status page, for a short letter about
// their AI interview after a person decided on their application. Modelled on the
// Reconsider queue beside it, and for the same reason: a decided candidate never reaches
// the ordinary Decisions queue (a reject clears `approval_kind`), so this is the only list
// on which they can be found.
//
// Self-contained: its own read (useFeedbackLetters) and its own editor, so the tab shell
// mounts it with one line. Open by default while someone is waiting, collapsed when
// nobody is — the empty state is still one click away and says so plainly.
import { useState } from "react";
import { MessageSquareText } from "lucide-react";
import { useTranslations } from "next-intl";
import { Defer } from "@/app/_components/ui/Defer";
import { BTN_SECONDARY, CHIP_QUIET } from "@/app/_components/ui/recipes";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { FeedbackLetterQueueItem } from "@/app/_lib/interview-letter-review";
import { useFeedbackLetters } from "./useFeedbackLetters";
import { DecisionsFeedbackLetterEditor } from "./DecisionsFeedbackLetterEditor";

export function DecisionsFeedbackLetters() {
  const t = useTranslations("decisions.feedbackLetters");
  const { date } = useDateFormat();
  const errMsg = useErrorMessage();
  const { items, truncated, failure, reload } = useFeedbackLetters();
  // null = the recruiter has not toggled it yet: follow the count.
  const [openChoice, setOpenChoice] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<FeedbackLetterQueueItem | null>(null);

  // First read still in flight, or failed before anything loaded and nothing to show
  // but the failure: the section is secondary to the queue above it and never holds the
  // tab's first paint.
  if (items === null && !failure) return null;
  const count = items?.length ?? 0;
  // A count is shown only when a list actually loaded: after a failed first read the
  // number is unknown, and "0" would claim nobody is waiting.
  const countLabel = items === null ? "—" : truncated ? `${count}+` : String(count);
  const open = openChoice ?? (count > 0 || items === null);
  // The editor reads the LIVE row (a redraft lands on it) and falls back to the snapshot
  // once a decision takes the letter off the list, so the outcome stays on screen.
  const live = selected ? (items?.find((i) => i.id === selected.id) ?? selected) : null;

  return (
    <Defer strategy="idle">
      <details open={open} onToggle={(ev) => setOpenChoice(ev.currentTarget.open)} className="rounded-lg border border-stone-200 bg-paper/40">
        <summary className="focus-ring flex cursor-pointer items-center gap-1.5 px-4 py-2.5 text-meta uppercase tracking-wide text-steel">
          <MessageSquareText size={13} className="text-coral" aria-hidden /> {t("title", { count: countLabel })}
        </summary>
        <div className="space-y-2 px-4 pb-3">
          <p className="text-sm text-steel">{t("help")}</p>
          {failure ? (
            <p role="alert" className="text-meta font-semibold text-coral">
              {errMsg(failure, t("loadFailed"))}
            </p>
          ) : null}
          {items && items.length === 0 ? <p className="text-sm text-stone-400">{t("empty")}</p> : null}
          {items && items.length > 0 ? (
            <ul className="space-y-1.5">
              {items.map((item) => (
                <li key={item.id} className="rounded-md border border-stone-100 bg-white px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-semibold text-ink">{item.candidateLabel ?? t("candidateUnknown")}</span>
                    {item.jobTitle ? <span className="text-steel">· {item.jobTitle}</span> : null}
                    <span className="text-stone-400">· {item.outcome === "hired" ? t("outcomeHired") : t("outcomeNotSelected")}</span>
                    <span className="text-stone-400">· {t("asked", { date: date(item.requestedAt) })}</span>
                    <span className={CHIP_QUIET}>
                      {item.closeOnly ? t("stateCloseOnly") : item.state === "drafted" ? t("stateDrafted") : t("stateRequested")}
                    </span>
                    <button type="button" onClick={() => setSelected(item)} className={`${BTN_SECONDARY} ml-auto h-8 px-2.5 text-sm`}>
                      {t("review")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </details>
      {live ? <DecisionsFeedbackLetterEditor key={live.id} item={live} onClose={() => setSelected(null)} onChanged={reload} /> : null}
    </Defer>
  );
}
