"use client";

// The reject/keep decision lists for the screening wave modal — rendered in
// BOTH the preview and committed states (the commit can legitimately differ
// from the approved preview: CAS skips, per-candidate comms failures). Split
// out of DecisionsScreenWaveModal so that component stays under 200 lines.
import { AlertTriangle, History } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { familyOverrideRejectCount, rowEffectiveFloor } from "./decisionsFloorDisclosure";
import type { WaveDecision } from "./decisionsScreenWaveTypes";

export function DecisionsScreenWaveLists({
  rejects,
  keeps,
  committed,
  dryRun,
  maxMatch,
  t,
}: {
  rejects: WaveDecision[];
  keeps: WaveDecision[];
  committed: boolean;
  dryRun: boolean;
  maxMatch: number;
  t: ReturnType<typeof useTranslations<"decisions.wave">>;
}) {
  const locale = useLocale();
  const shortDate = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(iso));
  // Direction 2 — the "JD edited since this score" chip, shared by both row lists.
  const staleChip = (d: WaveDecision) =>
    d.stale && d.staleSince ? (
      <span
        className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-meta font-semibold text-amber-800"
        title={t("jdEditedTitle", { date: shortDate(d.staleSince) })}
      >
        <History size={10} aria-hidden /> {t("jdEditedBadge", { date: shortDate(d.staleSince) })}
      </span>
    ) : null;
  // floors-tell-the-truth — a reject row whose EFFECTIVE floor (reasonParams.threshold,
  // threaded by screen-wave.ts) differs from the global slider was decided against a
  // per-family override. Surface that floor so the recruiter sees why a row above the
  // slider value still moved (or below it didn't). Informs; never blocks.
  const floorChip = (d: WaveDecision) => {
    const floor = rowEffectiveFloor(d.reasonParams);
    if (floor == null || floor === maxMatch) return null;
    return (
      <span
        className="ml-1.5 inline-flex items-center gap-1 rounded-full border border-stone-200 bg-white px-1.5 py-0.5 text-meta font-semibold text-steel"
        title={t("familyFloorTitle", { floor })}
      >
        {t("familyFloorBadge", { floor })}
      </span>
    );
  };
  // DEC4 — render the localized rationale from the structured reason code; the
  // persisted English `rationale` is the fallback (older shapes / unmapped code).
  // The reject code picks would/did phrasing from the run's dryRun flag and
  // appends the tie-adjustment note when one applied.
  const reasonText = (d: WaveDecision): string => {
    if (!d.reasonCode) return d.rationale;
    const p = d.reasonParams ?? {};
    if (d.reasonCode === "reject") {
      const base = t(dryRun ? "reasons.rejectWould" : "reasons.rejectDid", p as Record<string, string | number>);
      const tie = Number(p.tieAdjusted) > 0 ? ` ${t("reasons.tieAdjustedNote", { from: Number(p.tieAdjusted) })}` : "";
      return base + tie;
    }
    const key = `reasons.${d.reasonCode}` as Parameters<typeof t>[0];
    return t.has(key) ? t(key, p as Record<string, string | number>) : d.rationale;
  };
  // floors-tell-the-truth — how many rejects were decided against a family floor
  // that differs from the global slider (drives the summary line below the count).
  const overrideRejects = familyOverrideRejectCount(rejects, maxMatch);

  return (
    <>
      {rejects.length > 0 ? (
        <section>
          <p className="text-meta uppercase tracking-wide text-coral">
            {committed ? t("rejectedHeading", { count: rejects.length }) : t("wouldRejectHeading")}
          </p>
          {overrideRejects > 0 ? (
            // floors-tell-the-truth — why some rows moved against a floor that isn't the
            // slider value: a per-family override was in effect for them.
            <p className="mt-1 text-meta text-steel">{t("familyOverrideSummary", { count: overrideRejects })}</p>
          ) : null}
          <ul className="mt-1.5 space-y-1">
            {rejects.map((d) => (
              <li key={d.entryId} className="rounded-md border border-coral/30 bg-coral/5 px-2.5 py-1.5 text-sm">
                <span className="font-medium text-ink">{d.label}</span>{" "}
                <span className="nums text-steel">{d.matchScore == null ? "· —" : t("matchSuffix", { score: d.matchScore })}</span>
                {d.commsFailed ? (
                  <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-meta font-semibold text-amber-700">
                    <AlertTriangle size={10} aria-hidden /> {t("commsFailedBadge")}
                  </span>
                ) : null}
                {staleChip(d)}
                {floorChip(d)}
                <span className="mt-0.5 block text-meta text-steel">{reasonText(d)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {keeps.length > 0 ? (
        <section>
          <p className="text-meta uppercase tracking-wide text-steel">{t("keptHeading", { count: keeps.length })}</p>
          <ul className="mt-1.5 space-y-1">
            {keeps.map((d) => (
              <li key={d.entryId} className="flex items-baseline justify-between gap-2 px-2.5 py-1 text-sm">
                <span className="text-ink">
                  {/* An unscored keep shows a dash, not a number that reads as a
                      genuine 0 — the reason text beside it says why. */}
                  {d.label} <span className="nums text-steel">· {d.matchScore ?? "—"}</span>
                  {staleChip(d)}
                </span>
                <span className="shrink-0 text-meta text-steel">{reasonText(d)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
