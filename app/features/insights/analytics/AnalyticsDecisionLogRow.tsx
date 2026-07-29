"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { CHIP_QUIET } from "@/app/_components/ui/recipes";
import { ATTRIBUTION_BADGE, decisionMeta, timeAgo, PAGE_SIZE, type Decision } from "./analyticsDecisionLogTypes";

// One row of the analytics decision log, split out of AnalyticsDecisionLog.tsx
// (formerly DecisionLog.tsx) to keep that file under the 200-line cap.
export function DecisionLogRow({
  d,
  i,
  animate,
  label,
  boardHref,
  cohortText,
  reasonText,
  enumLabel,
}: {
  d: Decision;
  i: number;
  animate: boolean;
  // Precomputed via kindLabel(t, d.kind, { relayConfigured }) by the caller — kept
  // out of this module so it doesn't need the relayConfigured capability hook itself.
  label: string;
  boardHref: (q: string) => string;
  cohortText: (c: NonNullable<Decision["cohort"]>) => string;
  reasonText: (d: Decision) => string | null;
  enumLabel: (kind: string, value: string) => string;
}) {
  const t = useTranslations("analytics.log");
  const m = decisionMeta(d.kind);
  const badgeCls = ATTRIBUTION_BADGE[m.attribution];
  return (
    <li
      className={`flex items-center gap-3 py-2 ${animate ? "animate-fade-in" : ""}`}
      style={animate ? { animationDelay: `${(i % PAGE_SIZE) * 18}ms` } : undefined}
    >
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-meta font-semibold ${badgeCls}`}>
        {t(`attribution.${m.attribution}` as Parameters<typeof t>[0])}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-base text-ink">
          <span className={`font-medium ${m.tone}`}>{label}</span>
          {d.candidateLabel ? (
            d.entryId ? (
              <>
                <span className="text-steel">{" · "}</span>
                <Link
                  href={boardHref(d.candidateLabel)}
                  title={t("viewCandidate")}
                  className="focus-ring rounded text-steel underline-offset-2 hover:text-coral hover:underline"
                >
                  {d.candidateLabel}
                </Link>
              </>
            ) : (
              <span className="text-steel">{` · ${d.candidateLabel}`}</span>
            )
          ) : null}
          {d.fromStage && d.toStage && d.fromStage !== d.toStage ? (
            <span className="text-steel">
              {" "}
              {t("stageTransition", { from: enumLabel("stage", d.fromStage), to: enumLabel("stage", d.toStage) })}
            </span>
          ) : null}
          {/* Group-eval cohort provenance chip — over a chosen selection vs top-N */}
          {d.cohort ? <span className={`ml-2 align-middle ${CHIP_QUIET}`}>{cohortText(d.cohort)}</span> : null}
        </p>
        <DecisionDetail d={d} reason={reasonText(d)} boardHref={boardHref} viewLabel={t("viewCandidate")} />
      </div>
      <span className="shrink-0 text-sm text-steel">{timeAgo(d.createdAt)}</span>
    </li>
  );
}

// The second line of a log row. Precedence, all honest:
//   1. a localized sealed auto-reject reason (reconsider-earns-keep parity), else
//   2. a rematch counterpart deep-link (the board's ?q=<label> idiom) when the detail
//      parsed AND the counterpart still resolves to a live board entry, else
//   3. the raw event detail (honest plain text), else nothing.
function DecisionDetail({
  d,
  reason,
  boardHref,
  viewLabel,
}: {
  d: Decision;
  reason: string | null;
  boardHref: (q: string) => string;
  viewLabel: string;
}) {
  const t = useTranslations("analytics.log");
  if (reason) return <p className="truncate text-sm text-steel">{reason}</p>;
  if (d.counterpart) {
    const label = d.counterpart.label;
    return (
      <p className="truncate text-sm text-steel">
        {t.rich(d.kind === "rematched_from" ? "rematchFrom" : "rematchTo", {
          link: () => (
            <Link
              href={boardHref(label)}
              title={viewLabel}
              className="focus-ring rounded underline-offset-2 hover:text-coral hover:underline"
            >
              {label}
            </Link>
          ),
        })}
      </p>
    );
  }
  return d.detail ? <p className="truncate text-sm text-steel">{d.detail}</p> : null;
}
