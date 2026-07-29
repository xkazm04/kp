"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { CalibrationResult } from "@/app/_lib/calibration";

// Direction 2 — a bin opens the candidates behind it. Reuses the board deep-link
// idiom (buildUrl + cleared tab-scoped params, ?q=<label>) that the funnel and
// by-role table already use, so a candidate row lands on the board filtered to
// them. A live entry links; a terminal one (a rejected outcome-0) is listed but
// unlinked — records outlive the board. Split out of CalibrationPanel.tsx (now
// AnalyticsCalibrationPanel.tsx) to keep that file under the 200-line cap.

type BandCandidate = { label: string; score: number; outcome: 0 | 1; entryId: string | null; live: boolean };
type BandPayload = { bin: number; lo: number; hi: number; source: string; candidates: BandCandidate[] };

export function ScoreBands({
  result,
  source,
  roleFamily,
  boardHref,
}: {
  result: CalibrationResult;
  source: string;
  roleFamily: string;
  boardHref: (q: string) => string;
}) {
  const t = useTranslations("analytics.calibration");
  const [openBin, setOpenBin] = useState<number | null>(null);
  // Lazy per-bin fetch: only the opened band is loaded, and it stays unloaded
  // until its row is expanded (useJsonFetch always fetches). The reset happens in
  // the click handler — never a synchronous setState in the effect body — and the
  // parent remounts this component when source/family change (a key), so a stale
  // band can't leak across a source switch.
  const [data, setData] = useState<BandPayload | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (openBin == null) return;
    let alive = true;
    const url = `/api/analytics/calibration/band?source=${source}&bin=${openBin}${roleFamily ? `&roleFamily=${encodeURIComponent(roleFamily)}` : ""}`;
    fetch(url)
      .then(async (r) => {
        const body = (await r.json().catch(() => null)) as BandPayload | null;
        if (!alive) return;
        if (!r.ok || body == null) {
          setError(true);
          return;
        }
        setData(body);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [openBin, source, roleFamily]);
  const toggleBin = (bin: number) => {
    setData(null);
    setError(false);
    setOpenBin((cur) => (cur === bin ? null : bin));
  };
  // Bins carry a [lo,hi) score band (×100 from the probability bin edges).
  const bands = result.bins
    .map((b, i) => ({ i, lo: Math.round(b.lo * 100), hi: Math.round(b.hi * 100), count: b.count, observed: b.observed }))
    .filter((b) => b.count > 0);

  return (
    <div className="mt-5 border-t border-stone-200 pt-4">
      <p className="text-meta uppercase tracking-wide text-steel">{t("bandsTitle")}</p>
      <p className="mt-0.5 text-sm text-steel">{t("bandsBlurb")}</p>
      <ul className="mt-3 space-y-1.5">
        {bands.map((b) => {
          const isOpen = openBin === b.i;
          return (
            <li key={b.i} className="rounded-md border border-stone-200">
              <button
                type="button"
                onClick={() => toggleBin(b.i)}
                aria-expanded={isOpen}
                className="focus-ring flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left hover:bg-paper/70"
              >
                <span className="font-medium text-ink">{t("bandRange", { lo: b.lo, hi: b.hi })}</span>
                <span className="flex items-center gap-3 text-sm text-steel">
                  <span>{t("bandObserved", { pct: Math.round(b.observed * 100) })}</span>
                  <span className="rounded-full bg-paper px-2 py-0.5 text-meta font-semibold text-steel">
                    {t("bandCount", { n: b.count })}
                  </span>
                </span>
              </button>
              {isOpen ? (
                <div className="border-t border-stone-100 px-3 py-2">
                  {error ? (
                    <p className="text-sm text-coral" role="alert">
                      {t("bandError")}
                    </p>
                  ) : !data ? (
                    <p className="text-sm text-steel" role="status">
                      {t("bandLoading")}
                    </p>
                  ) : data.candidates.length === 0 ? (
                    <p className="text-sm text-steel">{t("bandEmpty")}</p>
                  ) : (
                    <ul className="divide-y divide-stone-100">
                      {data.candidates.map((c, i) => (
                        <li key={`${c.entryId ?? c.label}-${i}`} className="flex items-center justify-between gap-3 py-1.5">
                          <span className="min-w-0 flex-1 truncate">
                            {c.live ? (
                              <Link
                                href={boardHref(c.label)}
                                title={t("bandViewInBoard")}
                                className="focus-ring rounded text-ink underline-offset-2 hover:text-coral hover:underline"
                              >
                                {c.label}
                              </Link>
                            ) : (
                              <span className="text-ink">{c.label}</span>
                            )}
                          </span>
                          <span className="flex shrink-0 items-center gap-2 text-meta">
                            <span
                              className={`rounded-full px-1.5 py-0.5 font-semibold ${
                                c.outcome === 1 ? "bg-moss/10 text-moss" : "bg-coral/10 text-coral"
                              }`}
                            >
                              {c.outcome === 1 ? t("bandOutcomeAdvanced") : t("bandOutcomeRejected")}
                            </span>
                            <span className="text-steel">{t("bandCandidateScore", { score: c.score })}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
