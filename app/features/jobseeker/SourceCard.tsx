"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ExternalLink, Pause, Play, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/app/_components/Badge";
import { Tooltip } from "@/app/_components/Tooltip";
import { useDialogA11y } from "@/app/_components/useDialogA11y";
import { BTN_PRIMARY, BTN_SECONDARY, CHIP_QUIET, META_LABEL, NOTICE } from "@/app/_components/ui/recipes";
import { Collapse } from "@/app/features/hiring/pipeline/PipelineMotion";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import type { JobseekerSource } from "@/app/_lib/jobseeker/types";
import { FailureNotice } from "./FailureNotice";
import { RulesAuthoring } from "./RulesAuthoring";
import { SourceSwitch } from "./SourceSwitch";
import { callJson, type ApiFailure, type CatalogEntryView } from "./sourcesApi";

// One tier A or tier B source, as a LEDGER ROW rather than a card.
//
// It was a `${PANEL} p-4` card, so a workspace with eight sources was eight stacked
// cards with eight borders and eight shadows — nesting where the reader wanted a list.
// It now wears the roster's density (`ProfileRosterRow`: hairline-parted rows,
// `hover:bg-paper/70`, a trailing action cell) inside ONE panel owned by the tier
// section: planes parted by a rule, not boxes inside boxes (surface-doctrine §2).
// The row renders NO `<li>` — `ArrivalList` owns the list item so the cascade can
// animate it.
//
// Tier A is a plain switch. Tier B's switch is the ACKNOWLEDGEMENT door: the first
// enable answers 409 JOBSEEKER_SOURCE_NOT_ACKNOWLEDGED with the terms hash, and this
// row then shows the block (DevPublishConfirm's shape: alertdialog, the checkbox FIRST
// in focus order, the CTA disabled until it is ticked) and re-sends
// `{enabled: true, acknowledge: true}`. A hash that differs from the one the owner
// acknowledged before means the summary changed, and the block says so.
//
// The tier B evidence (robots summary, the quoted terms clause, our cadence) is
// EVIDENCE ON DEMAND (surface-doctrine §4): folded behind its own disclosure so a
// scan of eight rows is a list of names, and force-opened whenever the acknowledgement
// block is up — that is the one moment the owner must have read it.
//
// `blocked` / `collapsed` are pause reasons the SCAN set and a scan never clears;
// only the owner's Resume does, here.
//
// Icon sizes follow the rule stated in SourceSwitch.tsx: 13 inline in a row, 14 on a
// labelled action button, 16 on a text-free IconAction.

const OUTCOME_TONE = { succeeded: "positive", collapsed: "caution", blocked: "caution", offline: "neutral", failed: "critical", skipped: "neutral" } as const;

export function SourceCard({ source, entry, onChange }: { source: JobseekerSource; entry: CatalogEntryView | null; onChange(next: JobseekerSource): void }) {
  const t = useTranslations("me.sources");
  const rel = useRelativeTime();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [ack, setAck] = useState<{ termsHash: string; changed: boolean } | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);

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
  const hasEvidence = source.tier === "B";
  return (
    <div className="border-b border-stone-100 transition-colors last:border-0 hover:bg-paper/70">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 text-sm">
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold text-ink">{label}</span>
          <span className="truncate text-steel">{source.host}</span>
          <span className={CHIP_QUIET}>{t(`kind.${source.kind}`)}</span>
          <span className={CHIP_QUIET}>{t("tierChip", { tier: source.tier })}</span>
        </span>

        {/* State, as pills and a numeral-free sentence — never a coloured paragraph.
            The pause REASON rides in the pill's tooltip instead of spending a line. */}
        <span className="flex flex-wrap items-center gap-2 text-steel">
          {source.pausedReason ? (
            <Tooltip label={t("paused", { reason: t(`pauseReason.${source.pausedReason}`), when: source.pausedAt ? rel(source.pausedAt) : "" })}>
              <Badge tone="caution" label={t("pausedPill")} />
            </Tooltip>
          ) : null}
          {source.lastRunAt && source.lastOutcome ? (
            <>
              <Badge tone={OUTCOME_TONE[source.lastOutcome]} label={t(`outcome.${source.lastOutcome}`)} />
              <span>{t("lastRun", { when: rel(source.lastRunAt) })}</span>
            </>
          ) : (
            <span>{t("neverRun")}</span>
          )}
        </span>

        {/* The trailing action cell — the roster's shape: every row's controls end on
            the same axis, so the column scans. */}
        <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          <SourceSwitch
            on={source.enabled}
            label={t("toggleLabel", { label })}
            onLabel={t("enabled")}
            offLabel={t("disabled")}
            busy={busy}
            onToggle={() => void patch({ enabled: !source.enabled })}
          />
          {source.pausedReason ? (
            <button type="button" className={`${BTN_SECONDARY} h-8 px-2.5 text-sm`} disabled={busy} onClick={() => void patch({ resume: true })}>
              <Play size={14} aria-hidden /> {t("resume")}
            </button>
          ) : source.enabled ? (
            <button type="button" className={`${BTN_SECONDARY} h-8 px-2.5 text-sm`} disabled={busy} onClick={() => void patch({ pause: "owner" })}>
              <Pause size={14} aria-hidden /> {t("pause")}
            </button>
          ) : null}
          {source.kind === "board" ? (
            <button type="button" className={`${BTN_SECONDARY} h-8 px-2.5 text-sm`} aria-expanded={rulesOpen} onClick={() => setRulesOpen((v) => !v)}>
              <SlidersHorizontal size={14} aria-hidden /> {source.adapter === "board_rules" ? t("rules.open") : t("preview.open")}
            </button>
          ) : null}
          {hasEvidence ? (
            <button type="button" className={`${BTN_SECONDARY} h-8 px-2.5 text-sm`} aria-expanded={evidenceOpen || ack !== null} onClick={() => setEvidenceOpen((v) => !v)}>
              <ChevronDown size={14} aria-hidden className={evidenceOpen || ack !== null ? "rotate-180 transition-transform" : "transition-transform"} /> {t("terms")}
            </button>
          ) : null}
        </span>
      </div>

      {hasEvidence ? (
        <Collapse show={evidenceOpen || ack !== null}>
          <dl className="grid gap-x-6 gap-y-2 px-3 pb-3 text-sm sm:grid-cols-[auto_1fr]">
            <dt className={META_LABEL}>{t("robots")}</dt>
            <dd className="text-steel">{entry?.robotsSummary || t("robotsUnknown")}</dd>
            <dt className={META_LABEL}>{t("terms")}</dt>
            <dd className="text-steel">
              {entry?.termsQuote || t("termsUnknown")}
              {entry?.termsUrl ? (
                <>
                  {" "}
                  <a href={entry.termsUrl} target="_blank" rel="noopener noreferrer" className="focus-ring inline-flex items-center gap-1 rounded text-ink underline">
                    {t("termsLink")} <ExternalLink size={13} aria-hidden />
                  </a>
                </>
              ) : null}
            </dd>
            <dt className={META_LABEL}>{t("cadence")}</dt>
            <dd className="text-steel">{entry?.cadenceNote || t("cadenceDefault")}</dd>
          </dl>
        </Collapse>
      ) : entry?.cadenceNote ? (
        <p className="px-3 pb-2.5 text-sm text-steel">{entry.cadenceNote}</p>
      ) : null}

      <Collapse show={ack !== null}>
        <AckBlock changed={ack?.changed ?? false} busy={busy} onConfirm={() => void patch({ enabled: true, acknowledge: true })} onCancel={() => setAck(null)} />
      </Collapse>

      {/* One failure block for the whole surface (FailureNotice), never a bare red
          line: the sentence resolves by CODE and the notice is what the reader acts on. */}
      {error ? <FailureNotice failure={error} fallback={t("updateError")} className="mx-3 mb-3" onDismiss={() => setError(null)} /> : null}

      <Collapse show={rulesOpen && source.kind === "board"}>
        <div className="px-3 pb-3">
          <RulesAuthoring source={source} onSaved={onChange} />
        </div>
      </Collapse>
    </div>
  );
}

function AckBlock({ changed, busy, onConfirm, onCancel }: { changed: boolean; busy: boolean; onConfirm(): void; onCancel(): void }) {
  const t = useTranslations("me.sources.ack");
  const ref = useRef<HTMLDivElement | null>(null);
  const [checked, setChecked] = useState(false);
  useDialogA11y(ref, onCancel, { trap: true, lockScroll: false });
  // The block INHERITS `NOTICE("amber")`'s own text tone. It used to repaint every line
  // inside itself (`text-amber-700`/`-800`/`-900`), which is a recipe overriding itself
  // in three directions: emphasis is weight, not a fourth shade.
  return (
    <div ref={ref} role="alertdialog" aria-modal="true" aria-label={t("title")} tabIndex={-1} className={`mx-3 mb-3 ${NOTICE("amber")} p-3`} data-testid="source-ack">
      <p className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide">
        <ShieldCheck size={13} aria-hidden /> {t("title")}
      </p>
      <p className="mt-1.5 max-w-prose text-sm">{t("body")}</p>
      {changed ? <p className="mt-1.5 text-sm font-semibold">{t("changed")}</p> : null}
      <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm">
        <li>{t("reason1")}</li>
        <li>{t("reason2")}</li>
        <li>{t("reason3")}</li>
      </ul>
      {/* Source order IS focus order: the checkbox comes first, so it takes focus, and
          the CTA stays disabled until it is ticked. */}
      <label className="mt-3 flex items-start gap-2 text-sm font-semibold">
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
