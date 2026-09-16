"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Bookmark, BookmarkCheck, ExternalLink, RotateCcw, XCircle } from "lucide-react";
import { Badge, FitTierBadge } from "@/app/_components/Badge";
import { BTN_GHOST, BTN_SECONDARY, CHIP_QUIET, PANEL } from "@/app/_components/ui/recipes";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import type { DismissReason, JobseekerPostingSummary } from "@/app/_lib/jobseeker/types";
import { useFitTierLabels } from "@/app/features/shared/matchLabels";
import { DismissPicker } from "./DismissPicker";
import { EligibilityChips } from "./EligibilityChips";

// One feed row. The fit total leads (a bare numeral + the shared FitTierBadge, so the
// tier words are the recruiter side's), then the confidence band, then the eligibility
// chips; the title links to the detail page. An UNSCORED posting (KO'd by the hard
// filter, or not yet matched) says "not scored", never "0 %": a posting the filter
// dropped is not comparable, and the feed must not read it as a bad match.

export function PostingCard({
  row,
  sourceLabel,
  busy,
  onShortlist,
  onApplied,
  onDismiss,
  onRestore,
}: {
  row: JobseekerPostingSummary;
  sourceLabel: string;
  busy: boolean;
  onShortlist(next: boolean): void;
  onApplied(): void;
  onDismiss(reason: DismissReason, note: string): void;
  onRestore(): void;
}) {
  const t = useTranslations("me.jobs");
  const rel = useRelativeTime();
  const tierLabels = useFitTierLabels();
  const [dismissing, setDismissing] = useState(false);
  const live = row.status !== "dismissed" && row.status !== "gone";
  const meta = [row.company, row.location, row.workMode ? t(`workMode.${row.workMode}`) : null].filter((x): x is string => !!x);
  return (
    <li className={`${PANEL} p-4`}>
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex w-20 shrink-0 flex-col items-center gap-1 text-center">
          {row.matchTotal !== null ? (
            <>
              <span className="font-serif text-h2 leading-none text-ink nums">{Math.round(row.matchTotal)}</span>
              <FitTierBadge tier={row.fitTier} labels={tierLabels} />
            </>
          ) : (
            <span className={CHIP_QUIET}>{t("card.unscored")}</span>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/me/jobs/${encodeURIComponent(row.id)}`} className="focus-ring min-w-0 truncate rounded font-semibold text-ink hover:underline">
              {row.title}
            </Link>
            <Badge tone={row.status === "applied" ? "positive" : row.status === "shortlisted" ? "info" : row.status === "new" ? "neutral" : "caution"} label={t(`status.${row.status}`)} />
            {row.deepDived ? <span className={CHIP_QUIET}>{t("card.deepDived")}</span> : null}
          </div>
          {meta.length > 0 ? <p className="text-sm text-steel">{meta.join(" · ")}</p> : null}
          <p className="text-sm text-steel">
            {t("card.source", { label: sourceLabel })}
            {" · "}
            {/* An applied row answers a different question. `lastSeenAt` is the CRAWLER's
                last re-read of the board; once the seeker has applied, the date that
                matters is the one THEY acted on. A row applied before applied_at existed
                has none, and falls back to the crawler's date rather than inventing one. */}
            {row.status === "applied" && row.appliedAt ? t("card.applied", { when: rel(row.appliedAt) }) : t("card.seen", { when: rel(row.lastSeenAt) })}
            {row.confidence ? (
              <>
                {" · "}
                {t("card.confidence", { level: t(`confidenceLevel.${row.confidence.level}`), low: Math.round(row.confidence.low), high: Math.round(row.confidence.high) })}
              </>
            ) : null}
          </p>
          <EligibilityChips flags={row.eligibility} />
          {row.status === "dismissed" && row.dismissReason ? (
            <p className="text-sm text-steel">
              {t("card.dismissed", { reason: t(`dismiss.reason.${row.dismissReason}`) })}
              {row.dismissNote ? ` (${row.dismissNote})` : ""}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5 sm:flex-col sm:items-stretch">
          {live ? (
            <>
              <button type="button" className={`${BTN_SECONDARY} h-8 px-2.5 text-sm`} disabled={busy} onClick={() => onShortlist(row.status !== "shortlisted")}>
                {row.status === "shortlisted" ? <BookmarkCheck size={14} aria-hidden /> : <Bookmark size={14} aria-hidden />}
                {row.status === "shortlisted" ? t("action.unshortlist") : t("action.shortlist")}
              </button>
              {row.status !== "applied" ? (
                <button type="button" className={`${BTN_SECONDARY} h-8 px-2.5 text-sm`} disabled={busy} onClick={onApplied}>
                  <ExternalLink size={14} aria-hidden /> {t("action.applied")}
                </button>
              ) : null}
              <button type="button" className={`${BTN_GHOST} h-8 px-2.5 text-sm`} disabled={busy} aria-expanded={dismissing} onClick={() => setDismissing((v) => !v)}>
                <XCircle size={14} aria-hidden /> {t("action.dismiss")}
              </button>
            </>
          ) : row.status === "dismissed" ? (
            <button type="button" className={`${BTN_SECONDARY} h-8 px-2.5 text-sm`} disabled={busy} onClick={onRestore}>
              <RotateCcw size={14} aria-hidden /> {t("action.restore")}
            </button>
          ) : null}
        </div>
      </div>
      {dismissing ? (
        <DismissPicker
          title={row.title}
          busy={busy}
          onConfirm={(reason, note) => {
            setDismissing(false);
            onDismiss(reason, note);
          }}
          onCancel={() => setDismissing(false)}
        />
      ) : null}
    </li>
  );
}
