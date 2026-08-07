"use client";

import { AlertTriangle } from "lucide-react";
import type { useTranslations } from "next-intl";
import type { Matrix } from "./matrixTabTypes";

// The Fit Matrix's data-quality notices: unassessed-hidden count, the coverage
// gap banner (open roles with no strong fit), the pool-cap notice, and the
// missing-positions/missing-candidates warnings. Split out of MatrixTab.tsx to
// keep that file under the 200-line cap.
export function MatrixDataNotices({
  data,
  minFit,
  hiddenUnassessed,
  scopedPosition,
  coverage,
  t,
}: {
  data: Matrix | null;
  minFit: number;
  hiddenUnassessed: number;
  scopedPosition: unknown;
  coverage: { uncovered: string[]; total: number };
  t: ReturnType<typeof useTranslations<"matrix">>;
}) {
  return (
    <>
      {/* Distinguish "no scored role" from "below the fit floor" (skill-matrix-coverage
          #4): a candidate blocked/unscored on every shown role is HIDDEN by a floor, but
          for a different, actionable reason than a genuine weak fit — say so plainly. */}
      {data && minFit > 0 && hiddenUnassessed > 0 ? (
        <p className="text-meta text-steel">{t("unassessedHidden", { count: hiddenUnassessed })}</p>
      ) : null}

      {/* Coverage gap — the headline talent-intelligence signal: open roles with no
          strong fit. Only meaningful across ≥2 columns (a single scoped role is trivial). */}
      {!scopedPosition && coverage.total >= 2 && coverage.uncovered.length > 0 ? (
        <div role="status" className="mt-3 flex flex-wrap items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-700" aria-hidden />
          <p className="text-amber-900">
            <span className="font-semibold">{t("coverageGap", { uncovered: coverage.uncovered.length, total: coverage.total })}</span>{" "}
            <span className="text-amber-800">{coverage.uncovered.join(", ")}</span>
          </p>
        </div>
      ) : null}

      {data && data.poolTotal != null && data.poolCap != null && data.poolTotal > data.poolCap ? (
        <p
          role="status"
          className="flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          title={`${data.poolCap} of ${data.poolTotal} candidates scored`}
        >
          <AlertTriangle size={15} className="shrink-0 text-amber-700" aria-hidden />
          {/* Reuses the existing ofCount key ("{shown} of {total}") so the pool cap
              is visible without a new i18n string. */}
          <span>{t("ofCount", { shown: data.poolCap, total: data.poolTotal })}</span>
        </p>
      ) : null}

      {data && data.missing.length > 0 ? (
        <p className="rounded-md border border-amber-200 bg-amber-50/60 p-3 text-sm text-amber-800">
          {t.rich("missingPositions", {
            count: data.missing.length,
            titles: data.missing.map((m) => m.title).join(", "),
            b: (chunks) => <span className="font-semibold">{chunks}</span>,
          })}
        </p>
      ) : null}

      {data && data.missingCandidates.length > 0 ? (
        <p className="rounded-md border border-amber-200 bg-amber-50/60 p-3 text-sm text-amber-800">
          {t.rich("missingCandidatesPrefix", {
            count: data.missingCandidates.length,
            b: (chunks) => <span className="font-semibold">{chunks}</span>,
          })}
          {data.missingCandidates.map((m, i) => (
            <span key={m.id}>
              {i > 0 ? ", " : ""}
              <span title={m.error} className="cursor-help underline decoration-dotted decoration-amber-400">
                {m.label}
              </span>
            </span>
          ))}
          {"."}
        </p>
      ) : null}
    </>
  );
}
