"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Ban, Check, Loader2, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { SCREENING_DEFAULT } from "@/app/_lib/decision-config-schema";

// One decision in the wave (mirrors ScreenDecision in screen-wave.ts). DEC4 —
// `reasonCode`/`reasonParams` are the locale-renderable mirror of the English
// `rationale`; older shapes without them fall back to the raw string.
type Decision = {
  entryId: string;
  label: string;
  archetype: string | null;
  matchScore: number;
  action: "reject" | "keep";
  rationale: string;
  reasonCode?: string;
  reasonParams?: Record<string, string | number>;
};
type WaveResult = { decisions: Decision[]; rejected: number; kept: number; cohort: number; commsFailures: number; dryRun: boolean };

// Run the screening auto-reject wave for one role (DEC1) — but ALWAYS preview
// first (DEC2). The wave is irreversible (flips statuses + queues rejection
// emails), so this modal dry-runs on open and on every slider change, showing
// exactly who WOULD be rejected with rationales; the recruiter tunes the
// bottom-% / match threshold, watches the count update, then explicitly commits.
// The recruiter triggered this, so auto-reject is on for the run by default — but
// fairness shielding (early-career / unknown archetype) still applies server-side.
export function ScreenWaveModal({
  jobId,
  roleTitle,
  onClose,
  onCommitted,
}: {
  jobId: string;
  roleTitle: string;
  onClose: () => void;
  onCommitted: () => void;
}) {
  const t = useTranslations("decisions.wave");
  const [enabled, setEnabled] = useState(true);
  const [bottomPercent, setBottomPercent] = useState(SCREENING_DEFAULT.rejectBottomPercent);
  const [maxMatch, setMaxMatch] = useState(SCREENING_DEFAULT.maxMatchToReject);
  const [preview, setPreview] = useState<WaveResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState<WaveResult | null>(null);

  const override = () => ({ autoRejectEnabled: enabled, rejectBottomPercent: bottomPercent, maxMatchToReject: maxMatch });

  // Debounced dry-run preview on open + whenever the override changes. Skipped once
  // committed (the modal then shows the committed result).
  useEffect(() => {
    if (committed) return;
    let alive = true;
    // Loading state is part of THIS data-fetching effect's lifecycle (true on start, false on
    // settle below) — the legitimate fetch-in-effect pattern, not a cascading-render concern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const h = window.setTimeout(() => {
      fetch("/api/decisions/screen-wave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, override: override(), dryRun: true }),
      })
        .then(async (r) => {
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || `Preview failed (${r.status}).`);
          return d as WaveResult;
        })
        .then((d) => {
          if (alive) {
            setPreview(d);
            setError(null);
          }
        })
        .catch((e) => {
          if (alive) setError(e instanceof Error ? e.message : t("previewFailed"));
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 350);
    return () => {
      alive = false;
      window.clearTimeout(h);
    };
  }, [enabled, bottomPercent, maxMatch, jobId, committed, t]);

  const commit = async () => {
    setCommitting(true);
    setError(null);
    try {
      const r = await fetch("/api/decisions/screen-wave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, override: override(), dryRun: false }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `Wave failed (${r.status}).`);
      setCommitted(d as WaveResult);
      onCommitted(); // live-refresh the queue so rejected rows drop out
    } catch (e) {
      setError(e instanceof Error ? e.message : t("waveFailed"));
    } finally {
      setCommitting(false);
    }
  };

  const view = committed ?? preview;
  const rejects = view?.decisions.filter((d) => d.action === "reject") ?? [];
  const keeps = view?.decisions.filter((d) => d.action === "keep") ?? [];

  // DEC4 — render the localized rationale from the structured reason code; the
  // persisted English `rationale` is the fallback (older shapes / unmapped code).
  // The reject code picks would/did phrasing from the run's dryRun flag and
  // appends the tie-adjustment note when one applied.
  const reasonText = (d: Decision): string => {
    if (!d.reasonCode) return d.rationale;
    const p = d.reasonParams ?? {};
    if (d.reasonCode === "reject") {
      const base = t(view?.dryRun ? "reasons.rejectWould" : "reasons.rejectDid", p as Record<string, string | number>);
      const tie = Number(p.tieAdjusted) > 0 ? ` ${t("reasons.tieAdjustedNote", { from: Number(p.tieAdjusted) })}` : "";
      return base + tie;
    }
    const key = `reasons.${d.reasonCode}` as Parameters<typeof t>[0];
    return t.has(key) ? t(key, p as Record<string, string | number>) : d.rationale;
  };

  return (
    <Modal
      title={t("title", { role: roleTitle })}
      subtitle={committed ? t("committedSubtitle") : t("previewSubtitle")}
      onClose={onClose}
      size="3xl"
      footer={
        committed ? (
          <button
            type="button"
            onClick={onClose}
            className="focus-ring inline-flex h-9 items-center rounded-md bg-ink px-4 text-sm font-semibold text-white hover:bg-ink/90"
          >
            {t("done")}
          </button>
        ) : (
          <button
            type="button"
            onClick={commit}
            disabled={committing || loading || !enabled || rejects.length === 0}
            title={!enabled ? t("enableToCommit") : rejects.length === 0 ? t("nothingToReject") : undefined}
            className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md bg-coral px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
          >
            <Ban size={15} /> {committing ? t("rejecting") : t("rejectAndNotify", { count: rejects.length })}
          </button>
        )
      }
    >
      {committed ? (
        <div className="space-y-3">
          <p className="flex items-center gap-2 rounded-md border border-moss/40 bg-moss/5 p-3 text-base text-ink">
            <Check size={16} className="text-moss" />
            {t.rich("committedBanner", {
              rejected: committed.rejected,
              kept: committed.kept,
              cohort: committed.cohort,
              b: (chunks) => <span className="font-semibold">{chunks}</span>,
            })}
            {committed.commsFailures > 0 ? (
              <span className="text-amber-700"> {t("commsFailures", { count: committed.commsFailures })}</span>
            ) : null}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Override controls — drive the live preview. */}
          <div className="rounded-md border border-stone-200 bg-paper p-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-ink">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-coral" />
              {t("autoRejectWeakest")}
            </label>
            <div className={`mt-3 space-y-3 ${enabled ? "" : "pointer-events-none opacity-40"}`}>
              <label className="block">
                <span className="flex items-center justify-between text-sm text-ink">
                  <span>{t("rejectBottom")}</span>
                  <span className="nums font-semibold">{bottomPercent}%</span>
                </span>
                <input type="range" min={0} max={100} step={5} value={bottomPercent} onChange={(e) => setBottomPercent(Number(e.target.value))} className="mt-1 w-full accent-coral" />
              </label>
              <label className="block">
                <span className="flex items-center justify-between text-sm text-ink">
                  <span>{t("onlyIfBelow")}</span>
                  <span className="nums font-semibold">{maxMatch}</span>
                </span>
                <input type="range" min={0} max={100} step={5} value={maxMatch} onChange={(e) => setMaxMatch(Number(e.target.value))} className="mt-1 w-full accent-coral" />
              </label>
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-meta text-steel">
              <ShieldCheck size={12} className="text-moss" /> {t("shieldNote")}
            </p>
          </div>

          {error ? (
            <p role="alert" className="flex items-center gap-2 rounded-md bg-red-50 p-2.5 text-sm text-red-700">
              <AlertTriangle size={14} /> {error}
            </p>
          ) : null}

          <p className="flex items-center gap-2 text-base text-ink" aria-live="polite">
            {loading ? <Loader2 size={15} className="animate-spin text-coral" /> : null}
            {view ? (
              <span>
                {t.rich("wouldReject", {
                  rejected: rejects.length,
                  cohort: view.cohort,
                  b: (chunks) => <span className="font-semibold text-coral">{chunks}</span>,
                })}{" "}
                · <span className="text-steel">{t("keptCount", { count: keeps.length })}</span>
              </span>
            ) : (
              <span className="text-steel">{t("computingPreview")}</span>
            )}
          </p>

          {rejects.length > 0 ? (
            <section>
              <p className="text-meta uppercase tracking-wide text-coral">{t("wouldRejectHeading")}</p>
              <ul className="mt-1.5 space-y-1">
                {rejects.map((d) => (
                  <li key={d.entryId} className="rounded-md border border-coral/30 bg-coral/5 px-2.5 py-1.5 text-sm">
                    <span className="font-medium text-ink">{d.label}</span> <span className="nums text-steel">{t("matchSuffix", { score: d.matchScore })}</span>
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
                      {d.label} <span className="nums text-steel">· {d.matchScore}</span>
                    </span>
                    <span className="shrink-0 text-meta text-steel">{reasonText(d)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
