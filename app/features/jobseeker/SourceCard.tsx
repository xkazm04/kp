"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, ExternalLink, Loader2, Pause, Play, ShieldCheck } from "lucide-react";
import { Badge } from "@/app/_components/Badge";
import { useDialogA11y } from "@/app/_components/useDialogA11y";
import { BTN_PRIMARY, BTN_SECONDARY, CHIP_QUIET, META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import type { JobseekerSource } from "@/app/_lib/jobseeker/types";
import { RulesAuthoring } from "./RulesAuthoring";
import { callJson, type ApiFailure, type CatalogEntryView } from "./sourcesApi";

// One tier A or tier B source. Tier A is a plain toggle. Tier B's toggle is the
// ACKNOWLEDGEMENT door: the first enable answers 409 JOBSEEKER_SOURCE_NOT_ACKNOWLEDGED
// with the terms hash, and this card then shows the block (DevPublishConfirm's shape:
// alertdialog, the checkbox FIRST in focus order, the CTA disabled until it is ticked)
// and re-sends `{enabled: true, acknowledge: true}`. A hash that differs from the one
// the owner acknowledged before means the summary changed, and the block says so.
//
// `blocked` / `collapsed` are pause reasons the SCAN set and a scan never clears;
// only the owner's Resume does, here.

const OUTCOME_TONE = { succeeded: "positive", collapsed: "caution", blocked: "caution", offline: "neutral", failed: "critical", skipped: "neutral" } as const;

export function SourceCard({ source, entry, onChange }: { source: JobseekerSource; entry: CatalogEntryView | null; onChange(next: JobseekerSource): void }) {
  const t = useTranslations("me.sources");
  const rel = useRelativeTime();
  const resolveError = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [ack, setAck] = useState<{ termsHash: string; changed: boolean } | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);

  const patch = async (body: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const r = await callJson<{ source: JobseekerSource }>(`/api/jobseeker/sources/${encodeURIComponent(source.id)}`, { method: "PATCH", body: JSON.stringify(body) });
      if (!r.ok) {
        if (r.fail.code === "JOBSEEKER_SOURCE_NOT_ACKNOWLEDGED" && r.fail.termsHash) {
          setAck({ termsHash: r.fail.termsHash, changed: source.acknowledgedTermsHash !== null && source.acknowledgedTermsHash !== r.fail.termsHash });
          return false;
        }
        setError(r.fail);
        return false;
      }
      setAck(null);
      onChange(r.body.source);
      return true;
    } finally {
      setBusy(false);
    }
  };

  const label = entry?.label ?? source.host;
  return (
    <li className={`${PANEL} p-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink">{label}</span>
            <span className={CHIP_QUIET}>{t(`kind.${source.kind}`)}</span>
            <span className={CHIP_QUIET}>{t("tierChip", { tier: source.tier })}</span>
          </div>
          <p className="text-sm text-steel">{source.host}</p>
          {source.lastRunAt && source.lastOutcome ? (
            <p className="flex flex-wrap items-center gap-1.5 text-sm text-steel">
              <Badge tone={OUTCOME_TONE[source.lastOutcome]} label={t(`outcome.${source.lastOutcome}`)} />
              {t("lastRun", { when: rel(source.lastRunAt) })}
            </p>
          ) : (
            <p className="text-sm text-steel">{t("neverRun")}</p>
          )}
          {source.pausedReason ? (
            <p className="flex flex-wrap items-center gap-1.5 text-sm text-amber-700">
              <AlertTriangle size={13} aria-hidden />
              {t("paused", { reason: t(`pauseReason.${source.pausedReason}`), when: source.pausedAt ? rel(source.pausedAt) : "" })}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={source.enabled}
            aria-label={t("toggleLabel", { label })}
            disabled={busy}
            onClick={() => void patch({ enabled: !source.enabled })}
            className={`focus-ring inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-semibold disabled:opacity-60 ${source.enabled ? "bg-moss/15 text-moss" : "bg-stone-200 text-steel"}`}
          >
            {busy ? <Loader2 size={13} aria-hidden className="animate-spin" /> : null}
            {source.enabled ? t("enabled") : t("disabled")}
          </button>
          {source.pausedReason ? (
            <button type="button" className={`${BTN_SECONDARY} h-8 px-2.5 text-sm`} disabled={busy} onClick={() => void patch({ resume: true })}>
              <Play size={13} aria-hidden /> {t("resume")}
            </button>
          ) : source.enabled ? (
            <button type="button" className={`${BTN_SECONDARY} h-8 px-2.5 text-sm`} disabled={busy} onClick={() => void patch({ pause: "owner" })}>
              <Pause size={13} aria-hidden /> {t("pause")}
            </button>
          ) : null}
        </div>
      </div>

      {source.tier === "B" ? (
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          <dt className={META_LABEL}>{t("robots")}</dt>
          <dd className="text-steel">{entry?.robotsSummary || t("robotsUnknown")}</dd>
          <dt className={META_LABEL}>{t("terms")}</dt>
          <dd className="text-steel">
            {entry?.termsQuote || t("termsUnknown")}
            {entry?.termsUrl ? (
              <>
                {" "}
                <a href={entry.termsUrl} target="_blank" rel="noopener noreferrer" className="focus-ring inline-flex items-center gap-1 rounded text-ink underline">
                  {t("termsLink")} <ExternalLink size={11} aria-hidden />
                </a>
              </>
            ) : null}
          </dd>
          <dt className={META_LABEL}>{t("cadence")}</dt>
          <dd className="text-steel">{entry?.cadenceNote || t("cadenceDefault")}</dd>
        </dl>
      ) : entry?.cadenceNote ? (
        <p className="mt-2 text-sm text-steel">{entry.cadenceNote}</p>
      ) : null}

      {ack ? <AckBlock changed={ack.changed} busy={busy} onConfirm={() => void patch({ enabled: true, acknowledge: true })} onCancel={() => setAck(null)} /> : null}

      {error ? (
        <p className="mt-2 text-sm text-red-700" role="alert">
          {resolveError(error, t("updateError"))}
        </p>
      ) : null}

      {source.kind === "board" ? (
        <div className="mt-3">
          <button type="button" className={`${BTN_SECONDARY} h-8 px-2.5 text-sm`} aria-expanded={rulesOpen} onClick={() => setRulesOpen((v) => !v)}>
            {source.adapter === "board_rules" ? t("rules.open") : t("preview.open")}
          </button>
          {rulesOpen ? <RulesAuthoring source={source} onSaved={onChange} /> : null}
        </div>
      ) : null}
    </li>
  );
}

function AckBlock({ changed, busy, onConfirm, onCancel }: { changed: boolean; busy: boolean; onConfirm(): void; onCancel(): void }) {
  const t = useTranslations("me.sources.ack");
  const ref = useRef<HTMLDivElement | null>(null);
  const [checked, setChecked] = useState(false);
  useDialogA11y(ref, onCancel, { trap: true, lockScroll: false });
  return (
    <div ref={ref} role="alertdialog" aria-modal="true" aria-label={t("title")} tabIndex={-1} className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-4" data-testid="source-ack">
      <p className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-amber-700">
        <ShieldCheck size={13} aria-hidden /> {t("title")}
      </p>
      <p className="mt-1.5 max-w-prose text-sm text-amber-900">{t("body")}</p>
      {changed ? <p className="mt-1.5 text-sm font-medium text-amber-900">{t("changed")}</p> : null}
      <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-amber-800">
        <li>{t("reason1")}</li>
        <li>{t("reason2")}</li>
        <li>{t("reason3")}</li>
      </ul>
      {/* Source order IS focus order: the checkbox comes first, so it takes focus, and
          the CTA stays disabled until it is ticked. */}
      <label className="mt-3 flex items-start gap-2 text-sm font-medium text-amber-900">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5" />
        {t("checkbox")}
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={`${BTN_PRIMARY} h-8 px-3 text-sm`} disabled={!checked || busy} onClick={onConfirm}>
          {t("cta")}
        </button>
        <button type="button" className={`${BTN_SECONDARY} h-8 px-3 text-sm`} onClick={onCancel}>
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}
