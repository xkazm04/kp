"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { ThresholdEffect } from "@/app/_lib/calibration";
import { thresholdEffectClaim } from "./calibrationVerdict";

// threshold-story — the floor-over-time strip. Turns recommend→apply→HOPE into a
// visible loop: every sealed apply of the auto-reject floor is plotted over time
// (before→after, when, by whom), each drilling to its tamper-evident seal, and the
// LAST change's effect is measured — honestly gated on decisions-since. Reads the
// sealed decision records (no new store); renders nothing until at least one apply
// exists, so it never adds empty chrome. Fully tokenized → dark-safe, mirroring the
// DriftStrip SVG pattern. Split out of CalibrationPanel.tsx (now
// AnalyticsCalibrationPanel.tsx) to keep that file under the 200-line cap.

type ThresholdHistoryPoint = {
  seq: number;
  contentHash: string;
  at: string;
  approvedBy: string | null;
  direction: "lower" | "raise" | null;
  previous: number | null;
  next: number | null;
  band: { lo: number; hi: number } | null;
  n: number | null;
  advanceRatePct: number | null;
  roleFamily: string | null;
};
type ThresholdHistoryPayload = { history: ThresholdHistoryPoint[]; effect: ThresholdEffect | null };

const STRIP_W = 320;
const STRIP_H = 76;
const STRIP_PADX = 10;
const STRIP_PADY = 12;
function floorY(v: number): number {
  return STRIP_PADY + (1 - Math.max(0, Math.min(100, v)) / 100) * (STRIP_H - 2 * STRIP_PADY);
}
function stripDate(iso: string): string {
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
}

export function ThresholdHistoryStrip({ nonce, family }: { nonce: number; family: string }) {
  const t = useTranslations("analytics.calibration");
  const [data, setData] = useState<ThresholdHistoryPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [openSeq, setOpenSeq] = useState<number | null>(null);
  // The `failed` reset lives in the async success path (never a synchronous setState
  // in the effect body — mirrors ScoreBands): a fresh fetch that succeeds clears any
  // prior failure, so a transient error self-heals on the next nonce/family change.
  useEffect(() => {
    let alive = true;
    const url = `/api/analytics/calibration/threshold-history${family ? `?roleFamily=${encodeURIComponent(family)}` : ""}`;
    fetch(url)
      .then(async (r) => {
        const body = (await r.json().catch(() => null)) as ThresholdHistoryPayload | null;
        if (!alive) return;
        if (!r.ok || body == null) {
          setFailed(true);
          return;
        }
        setFailed(false);
        setData(body);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [nonce, family]);

  // Supplementary panel: on failure or before any apply exists, render nothing
  // rather than an error box — the calibration curve above is the primary signal.
  if (failed || !data || data.history.length === 0) return null;

  // Chronological (oldest → newest, left → right) for the plot; the record list keeps
  // the store's newest-first order.
  const asc = [...data.history].reverse();
  const n = asc.length;
  const stepX = n > 1 ? (STRIP_W - 2 * STRIP_PADX) / (n - 1) : 0;
  const pointX = (i: number) => STRIP_PADX + (n > 1 ? i * stepX : (STRIP_W - 2 * STRIP_PADX) / 2);
  const plottable = asc.filter((p) => p.next != null);
  const linePts = plottable.map((p) => `${pointX(asc.indexOf(p))},${floorY(p.next as number)}`).join(" ");
  const effect = data.effect;
  // Which of the three effect sentences this data can defend — resolved by the pure
  // module (calibrationVerdict.thresholdEffectClaim), pinned by calibrationVerdict.test.ts.
  const claim = thresholdEffectClaim(effect);

  return (
    <div className="mt-5 border-t border-stone-200 pt-4">
      <p className="text-meta uppercase tracking-wide text-steel">{t("historyTitle")}</p>
      <p className="mt-0.5 text-sm text-steel">{t("historyBlurb")}</p>

      {/* The strip: floor value (0–100) over each apply. Decorative — the applies are
          also exposed as a visually-hidden list below (WCAG 1.1.1) and as the record
          rows. Every stroke/fill resolves through a theme token. */}
      <ul className="sr-only">
        {asc.map((p) => (
          <li key={p.seq}>
            {t("historyPoint", { previous: p.previous ?? 0, next: p.next ?? 0, at: stripDate(p.at) })}
          </li>
        ))}
      </ul>
      <svg viewBox={`0 0 ${STRIP_W} ${STRIP_H}`} className="mt-3 h-16 w-full text-ink" aria-hidden="true" preserveAspectRatio="none">
        {/* 0 / 50 / 100 floor gridlines */}
        {[0, 50, 100].map((g) => (
          <line key={g} x1={STRIP_PADX} y1={floorY(g)} x2={STRIP_W - STRIP_PADX} y2={floorY(g)} className="stroke-stone-200" strokeWidth={1} />
        ))}
        {plottable.length > 1 ? <polyline points={linePts} fill="none" className="stroke-steel" strokeWidth={1.5} /> : null}
        {asc.map((p, i) =>
          p.next == null ? null : (
            <circle
              key={p.seq}
              cx={pointX(i)}
              cy={floorY(p.next)}
              r={4}
              className={p.direction === "raise" ? "fill-coral stroke-white" : "fill-moss stroke-white"}
              strokeWidth={1}
            />
          )
        )}
      </svg>

      {/* Direction-through-to-the-seal: each apply expands to its sealed-record
          identity (seq + content-hash fingerprint), the same fingerprint idiom the
          records panel renders. */}
      <ul className="mt-2 space-y-1.5">
        {data.history.map((p) => {
          const isOpen = openSeq === p.seq;
          return (
            <li key={p.seq} className="rounded-md border border-stone-200">
              <button
                type="button"
                onClick={() => setOpenSeq((cur) => (cur === p.seq ? null : p.seq))}
                aria-expanded={isOpen}
                className="focus-ring flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left hover:bg-paper/70"
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-meta font-semibold ${
                      p.direction === "raise" ? "bg-coral/10 text-coral" : "bg-moss/10 text-moss"
                    }`}
                  >
                    {p.direction === "raise" ? t("historyDirectionRaise") : t("historyDirectionLower")}
                  </span>
                  <span className="font-medium text-ink">{t("historyApply", { previous: p.previous ?? 0, next: p.next ?? 0 })}</span>
                </span>
                <span className="shrink-0 text-meta text-steel">{stripDate(p.at)}</span>
              </button>
              {isOpen ? (
                <div className="border-t border-stone-100 px-3 py-2 text-sm text-steel">
                  {p.band != null && p.advanceRatePct != null && p.n != null ? (
                    <p>{t("historyBasis", { lo: p.band.lo, hi: p.band.hi, pct: p.advanceRatePct, n: p.n })}</p>
                  ) : null}
                  {p.approvedBy ? <p className="mt-0.5">{t("historyBy", { who: p.approvedBy })}</p> : null}
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-meta text-stone-400">
                    <span className="font-mono">{t("historySealLabel", { seq: p.seq })}</span>
                    <span className="font-mono" title={p.contentHash}>
                      {t("historyFingerprint", { hash: `${p.contentHash.slice(0, 8)}…` })}
                    </span>
                  </p>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {/* "Since the last change" — the measured effect, gated on decisions-since. */}
      {effect && claim ? (
        <div className="mt-3 rounded-md border border-stone-200 bg-paper/60 p-3">
          <p className="text-meta uppercase tracking-wide text-steel">{t("effectTitle")}</p>
          {claim.kind === "too-few" ? (
            <p className="mt-1 text-sm text-steel">
              {t("effectTooFew", { lo: effect.band.lo, hi: effect.band.hi, min: effect.minOutcomes })}
            </p>
          ) : claim.kind === "after-only" ? (
            <p className="mt-1 text-sm text-ink">
              {t("effectAfterOnly", { lo: effect.band.lo, hi: effect.band.hi, pct: claim.after.advanceRatePct, n: claim.after.n })}
            </p>
          ) : (
            <p className="mt-1 text-sm text-ink">
              {t("effectDelta", {
                lo: effect.band.lo,
                hi: effect.band.hi,
                beforePct: claim.before.advanceRatePct,
                afterPct: claim.after.advanceRatePct,
                n: claim.after.n,
              })}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
