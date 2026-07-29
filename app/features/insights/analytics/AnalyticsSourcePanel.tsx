"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { labelOr } from "@/app/_lib/use-enum-label";
import type { SourceDelta } from "@/app/_lib/analytics-deltas";
import { DeltaChip } from "./AnalyticsDeltaChip";
import type { Analytics } from "./AnalyticsTypes";

// ANA4 — channel ROI: entries grouped by how they ENTERED the pipeline (derived
// server-side from each entry's earliest event kind), with the interview/hire
// payoff per channel. Answers "does the apply link or recruiter sourcing
// produce the candidates that actually get hired". Split out of AnalyticsTab.tsx
// to keep that file under the 200-line cap.
export function SourcePanel({ rows, deltas, channelsHref }: { rows: Analytics["bySource"]; deltas: SourceDelta[] | null; channelsHref: string }) {
  const t = useTranslations("analytics");
  const sourceLabel = (s: string) => labelOr(t, `source.${s}`, s);
  // Direction 2 — index the vs-prior movement by source; only present in a
  // windowed view (all-time has no prior window, so deltas is null).
  const deltaBySource = new Map((deltas ?? []).map((d) => [d.source, d]));
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <h3 className="font-serif text-h2 text-ink">{t("bySource")}</h3>
      {/* channel-story-complete — this view derives origin from each candidate's
          FIRST pipeline event; the Channel economics table below groups the stored
          source_channel. Different taxonomies on one page, so name each honestly. */}
      <p className="mt-0.5 text-meta uppercase tracking-wide text-steel">{t("bySourceHint")}</p>
      <ul className="mt-3 space-y-3">
        {rows.map((r) => {
          const d = deltaBySource.get(r.source);
          return (
          <li key={r.source}>
            <div className="flex items-baseline justify-between text-base">
              <span className="font-medium text-ink">{sourceLabel(r.source)}</span>
              <span className="flex items-baseline gap-1.5 font-medium text-moss">
                {r.hireRatePct}%
                {/* vs the prior equal-length window; higher hire rate is better. */}
                {d?.conversionPct ? <DeltaChip delta={d.conversionPct} unit="pts" /> : null}
              </span>
            </div>
            <p className="mt-0.5 flex items-baseline gap-1.5 text-sm text-steel">
              <span>{t("sourceLine", { total: r.total, interview: r.reachedInterview, hired: r.hired })}</span>
              {/* Volume movement — a bare count chip (more leads reads green). */}
              {d?.volume ? <DeltaChip delta={d.volume} /> : null}
            </p>
          </li>
          );
        })}
        {rows.length === 0 ? <li className="text-base text-steel">{t("noSourceData")}</li> : null}
      </ul>
      {/* Channel economics are configured on the Channels tab — give the ROI
          reading a destination instead of leaving it a dead report. */}
      <Link
        href={channelsHref}
        className="focus-ring mt-4 inline-flex items-center gap-1 text-sm font-semibold text-coral hover:underline"
      >
        {t("configureChannels")} <ArrowRight size={13} aria-hidden />
      </Link>
    </div>
  );
}
