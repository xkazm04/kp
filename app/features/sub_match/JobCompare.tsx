"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { ConfidenceBandBadge, ConfidenceRange, FitTierBadge } from "@/app/_components/Badge";
import { scoreTone, scoreToneColor } from "@/app/_lib/format";
import { formatBandCompact, type MatchResult } from "./MatchTypes";
import { useEnumLabel } from "@/app/_lib/use-enum-label";

// Compare-jobs-for-one-candidate (MAT5): the role-for-candidate mirror of the
// candidate-for-role compare. Given 2–4 selected matches, render a transposed
// table — roles as columns, attributes as rows — so "which of these roles fits
// best, and why" reads down a column instead of eyeballing stacked cards. All data
// is already on each MatchResult; no fetch.

export function JobCompare({ matches, onClose }: { matches: MatchResult[]; onClose: () => void }) {
  const t = useTranslations("match.jobCompare");
  const enumLabel = useEnumLabel();
  // Dimension rows: union of breakdown keys across the selected roles, labelled
  // from the first that carries each (archetype-aware labels), aligned by key.
  const dims: { key: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const m of matches) {
    for (const d of m.scoreBreakdown ?? []) {
      if (!seen.has(d.key)) {
        seen.add(d.key);
        dims.push({ key: d.key, label: d.label });
      }
    }
  }
  const pctOf = (m: MatchResult, key: string) => m.scoreBreakdown?.find((d) => d.key === key)?.percent ?? null;
  // Tint the winning cell per row so the column comparison reads without hunting.
  const leader = (vals: number[]) => (vals.length > 1 ? Math.max(...vals) : -Infinity);

  const totals = matches.map((m) => m.total);
  const totalLead = leader(totals);

  return (
    <div className="mt-4 rounded-lg border border-stone-200 bg-white p-3 shadow-panel">
      <div className="flex items-center justify-between">
        <p className="text-meta uppercase tracking-wide text-coral">{t("compareRoles", { count: matches.length })}</p>
        <button type="button" onClick={onClose} className="focus-ring inline-flex items-center gap-1 rounded px-2 py-0.5 text-sm font-semibold text-steel hover:text-ink">
          <X size={13} /> {t("close")}
        </button>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white p-2 text-left text-meta uppercase text-steel">{t("roleHeader")}</th>
              {matches.map((m) => (
                <th key={m.jobId} className="min-w-[140px] p-2 text-left align-bottom">
                  <p className="font-semibold text-ink">{m.title}</p>
                  <p className="text-meta text-steel">
                    {t("roleMeta", { company: m.company ?? "—", family: m.roleFamily ? enumLabel("family", m.roleFamily) : "—", seniority: m.seniority ?? "—" })}
                  </p>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-stone-100">
              <th scope="row" className="sticky left-0 bg-white p-2 text-left text-steel">{t("overallFit")}</th>
              {matches.map((m) => (
                <td key={m.jobId} className={`p-2 ${m.total === totalLead ? "bg-moss/5" : ""}`}>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="font-serif text-xl leading-none tabular-nums" style={{ color: scoreToneColor(scoreTone(m.total)) }}>{m.total}</span>
                    <FitTierBadge tier={m.fitTier} score={m.total} />
                  </span>
                </td>
              ))}
            </tr>
            <tr className="border-t border-stone-100">
              <th scope="row" className="sticky left-0 bg-white p-2 text-left text-steel">{t("confidence")}</th>
              {matches.map((m) => (
                <td key={m.jobId} className="p-2">
                  <span className="inline-flex items-center gap-1.5">
                    <ConfidenceRange low={m.confidence.low} high={m.confidence.high} drivers={m.confidence.drivers} className="nums text-steel" />
                    <ConfidenceBandBadge level={m.confidence.level} drivers={m.confidence.drivers} />
                  </span>
                </td>
              ))}
            </tr>
            {dims.map((d) => {
              const vals = matches.map((m) => pctOf(m, d.key) ?? -1);
              const lead = leader(vals.filter((v) => v >= 0));
              return (
                <tr key={d.key} className="border-t border-stone-100">
                  <th scope="row" className="sticky left-0 bg-white p-2 text-left text-steel">{d.label}</th>
                  {matches.map((m) => {
                    const pct = pctOf(m, d.key);
                    return (
                      <td key={m.jobId} className={`p-2 ${pct != null && pct === lead ? "bg-moss/5" : ""}`}>
                        {pct == null ? (
                          <span className="text-stone-300">—</span>
                        ) : (
                          <span className="flex items-center gap-1.5">
                            <span className="w-6 shrink-0 tabular-nums text-ink">{pct}</span>
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-100">
                              <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: scoreToneColor(scoreTone(pct)) }} />
                            </span>
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr className="border-t border-stone-100">
              <th scope="row" className="sticky left-0 bg-white p-2 text-left align-top text-steel">{t("matchedSkills")}</th>
              {matches.map((m) => (
                <td key={m.jobId} className="p-2 align-top">
                  <div className="flex flex-wrap gap-1">
                    {(m.matchedSkills ?? []).slice(0, 8).map((s) => (
                      <span key={s} className="rounded bg-green-50 px-1.5 py-0.5 text-sm text-green-700">{s}</span>
                    ))}
                    {(m.matchedSkills?.length ?? 0) === 0 ? <span className="text-stone-300">—</span> : null}
                  </div>
                </td>
              ))}
            </tr>
            <tr className="border-t border-stone-100">
              <th scope="row" className="sticky left-0 bg-white p-2 text-left align-top text-steel">{t("missingMustHaves")}</th>
              {matches.map((m) => (
                <td key={m.jobId} className="p-2 align-top">
                  <div className="flex flex-wrap gap-1">
                    {(m.missingSkills ?? []).slice(0, 8).map((s) => (
                      <span key={s} className="rounded bg-red-50 px-1.5 py-0.5 text-sm text-red-700">{`✗ ${s}`}</span>
                    ))}
                    {(m.missingSkills?.length ?? 0) === 0 ? <span className="text-moss">{t("none")}</span> : null}
                  </div>
                </td>
              ))}
            </tr>
            <tr className="border-t border-stone-100">
              <th scope="row" className="sticky left-0 bg-white p-2 text-left text-steel">{t("salaryBand")}</th>
              {matches.map((m) => (
                <td key={m.jobId} className="p-2 nums text-ink">{formatBandCompact(m.salaryBand)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
