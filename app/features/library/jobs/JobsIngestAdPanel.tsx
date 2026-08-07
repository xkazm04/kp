"use client";

import { ClipboardPaste, Plus } from "lucide-react";
import { MIN_AD_CHARS } from "@/app/_lib/split-ads";
import { Checkbox } from "@/app/_components/Checkbox";
import { TextArea } from "@/app/_components/TextArea";
import { useIngestAdPanelLogic, type IngestResult } from "./jobsIngestAdPanelLogic";
import { JobsIngestAdPanelResults } from "./JobsIngestAdPanelResults";

// "Paste a job ad" → POST /api/jobs/ingest. The parse backend (Claude CLI →
// structured, deduped, matchable Job) was fully built but had no UI caller, so a
// recruiter could only get roles in via the seed corpus or the JD builder — never
// the ad they were handed. Self-contained like DraftsPanel; threads an
// AbortController so navigating away mid-parse SIGKILLs the child (the route
// honors request.signal). On a content-hash hit the route returns created:false,
// surfaced as "already in the catalog" rather than a phantom second add.
// onIngested fires for the SINGLE-ad path (latch the just-added job open). Bulk uses
// onBulkComplete instead — fired ONCE after the loop — so a 10-ad import doesn't trigger
// 10 corpus refetches mid-run and doesn't hijack the screen with a modal for the last
// created row while the user is still reading the per-row results table.
export function IngestAdPanel({
  onIngested,
  onBulkComplete,
}: {
  onIngested?: (result: IngestResult) => void;
  onBulkComplete?: () => void;
}) {
  const { t, open, setOpen, adText, setAdText, busy, error, note, bulk, toggleBulk, results, progress, bulkCount, submit, submitBulk, cancelRun, close } =
    useIngestAdPanelLogic({ onIngested, onBulkComplete });

  if (!open) {
    return (
      <div className="mt-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="focus-ring inline-flex h-10 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-base font-semibold text-ink hover:border-coral/40"
        >
          <ClipboardPaste size={15} className="text-coral" /> {t("pasteAd")}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-coral/30 bg-coral/5 p-3">
      <label htmlFor="ingest-ad" className="text-meta uppercase tracking-wide text-coral">
        {t("pasteAd")}
      </label>
      <p className="mt-1 text-sm text-steel">{t("pasteIntro")}</p>
      <label className="mt-2 flex items-center gap-1.5 text-sm font-medium text-steel">
        <Checkbox checked={bulk} disabled={busy} onChange={(e) => toggleBulk(e.target.checked)} />
        {t("bulkToggle")}
        {bulk ? <span className="text-meta text-stone-400">· {t("bulkHint")}</span> : null}
      </label>
      <TextArea
        id="ingest-ad"
        value={adText}
        onChange={(e) => setAdText(e.target.value)}
        rows={bulk ? 10 : 6}
        disabled={busy}
        placeholder={bulk ? t("bulkPlaceholder") : t("pastePlaceholder")}
        sizeVariant="sm"
        className="mt-2 disabled:opacity-60"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {bulk ? (
          <button
            type="button"
            onClick={submitBulk}
            disabled={busy || bulkCount === 0}
            className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md bg-coral px-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            <Plus size={14} /> {busy && progress ? t("importing", { done: progress.done, total: progress.total }) : t("importAll", { count: bulkCount })}
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={busy || adText.trim().length < MIN_AD_CHARS}
            className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md bg-coral px-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            <Plus size={14} /> {busy ? t("parsing") : t("addToCatalog")}
          </button>
        )}
        {/* Two jobs, one button — and the busy one is the one that matters. A bulk
            import is minutes of billed LLM time per ad; while it runs this ABORTS the
            run (the signal is threaded to the route, which SIGKILLs the parser child)
            and leaves the panel + partial results standing. Idle, it closes the panel. */}
        <button
          type="button"
          onClick={busy ? cancelRun : close}
          className="focus-ring inline-flex h-9 items-center rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-steel hover:text-ink"
        >
          {busy ? t("cancelRun") : t("cancel")}
        </button>
        <span className="text-meta text-steel">{t("parsingNote")}</span>
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-red-700">{error}</p> : null}
      {note ? <p aria-live="polite" className="mt-2 text-sm text-steel">{note}</p> : null}
      {results ? <JobsIngestAdPanelResults results={results} t={t} /> : null}
    </div>
  );
}
