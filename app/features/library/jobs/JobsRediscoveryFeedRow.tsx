"use client";

import { Check, UserPlus, X } from "lucide-react";
import type { useTranslations } from "next-intl";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { PRIOR_STYLE, type Alert } from "./jobsRediscoveryFeedTypes";

// One rediscovery alert row (score, why-now copy, add/dismiss actions) —
// extracted verbatim from JobsRediscoveryFeed.tsx so that file stays under the
// 200-line split threshold.
export function JobsRediscoveryFeedRow({
  a,
  added,
  pending,
  error,
  onAdd,
  onDismiss,
  t,
  tr,
}: {
  a: Alert;
  added: boolean;
  pending: boolean;
  error: string | undefined;
  onAdd: () => void;
  onDismiss: () => void;
  t: ReturnType<typeof useTranslations<"jobs.rediscoveryFeed">>;
  tr: ReturnType<typeof useTranslations<"jobs.rediscover">>;
}) {
  const enumLabel = useEnumLabel();
  return (
    <li className="flex items-center gap-3 rounded-md border border-stone-200 bg-white px-3 py-2">
      <span className="shrink-0">
        <ScoreBadge score={a.score} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-medium text-ink">
          {t.rich("clears", {
            label: a.label,
            role: a.jobTitle,
            b: (chunks) => <span className="font-semibold">{chunks}</span>,
          })}
        </p>
        {/* feed-tells-why: rows carrying the live prior shape (stage present)
            tell the SAME localized why-now the panel does — whyNow.{kind} plus
            the "reached {stage}" disclosure when the band-limited depth boost
            lifted this candidate (depth > 0). Legacy rows (stage null, written
            before the migration) fall back to the persisted English chip. */}
        {a.prior.stage ? (
          <p className="mt-1 text-sm leading-snug text-steel">
            {tr(`whyNow.${a.prior.kind}`, { jobTitle: a.jobTitle, score: a.score })}
            {(a.prior.depth ?? 0) > 0
              ? " " + tr("whyNow.reached", { stage: enumLabel("stage", a.prior.stage) })
              : ""}
          </p>
        ) : (
          <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-meta ${PRIOR_STYLE[a.prior.kind] ?? PRIOR_STYLE.elsewhere}`}>
            {a.prior.label}
          </span>
        )}
        {error ? <span className="ml-2 text-meta text-coral">{error}</span> : null}
      </div>
      {added ? (
        <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-moss">
          <Check size={14} /> {t("added")}
        </span>
      ) : (
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onAdd}
            disabled={pending}
            className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-coral/40 bg-coral/5 px-2.5 py-1.5 text-sm font-semibold text-coral hover:bg-coral/10 disabled:opacity-50"
          >
            <UserPlus size={14} /> {pending ? t("adding") : t("addToPipeline")}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            title={t("dismiss")}
            aria-label={t("dismiss")}
            className="focus-ring inline-flex items-center rounded-md border border-stone-200 bg-white p-1.5 text-steel hover:text-ink"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </li>
  );
}
