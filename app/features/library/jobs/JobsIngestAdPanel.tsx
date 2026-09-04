"use client";

import { ClipboardPaste, Plus, X } from "lucide-react";
import { MIN_AD_CHARS } from "@/app/_lib/split-ads";
import { Checkbox } from "@/app/_components/Checkbox";
import { TextArea } from "@/app/_components/TextArea";
import type { IngestAdState } from "./jobsIngestAdPanelLogic";
import { JobsIngestAdPanelResults } from "./JobsIngestAdPanelResults";

// "Import a job position" → POST /api/jobs/ingest. The parse backend (Claude CLI
// → structured, deduped, matchable Job) was fully built but had no UI caller, so a
// recruiter could only get roles in via the seed corpus or the JD builder — never
// the posting they were handed. Threads an AbortController so navigating away
// mid-parse SIGKILLs the child (the route honors request.signal). On a content-hash
// hit the route returns created:false, surfaced as "already in the catalog" rather
// than a phantom second add.
//
// The state lives in useIngestAdPanelLogic and is OWNED BY JobsTab, not by this
// file: import is a header action ("Import position", top-right beside the title),
// while the form it opens is a full-width panel under the header — one hook, two
// mount points, so the trigger and the surface can never disagree about `open`. It
// used to be a self-contained button+panel sitting between the stat chips and the
// filters, which read as another row of table chrome rather than as the one way
// into the catalog.

/** The header action, top-right of the Jobs tab header. Toggles the panel below;
 *  it closes through the same `close()` the panel's own Cancel uses, so the paste
 *  and any run state are reset exactly once. Locked while a parse is in flight —
 *  that run costs billed LLM time and has one deliberate exit (Cancel run), which
 *  a header toggle must not become a second, silent door out of. */
export function IngestAdButton({ ingest }: { ingest: IngestAdState }) {
  const { t, open, setOpen, busy, close } = ingest;
  return (
    <button
      type="button"
      onClick={() => (open ? close() : setOpen(true))}
      disabled={busy}
      aria-expanded={open}
      className={`focus-ring inline-flex h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-base font-semibold transition-colors disabled:opacity-60 ${
        open ? "border-coral bg-coral/10 text-coral" : "border-stone-300 bg-white text-ink hover:border-coral/40"
      }`}
    >
      <ClipboardPaste size={15} className="text-coral" /> {t("pasteAd")}
    </button>
  );
}

/** The form the header action opens. Renders nothing while closed, so JobsTab can
 *  mount it unconditionally under the header. */
export function IngestAdPanel({ ingest }: { ingest: IngestAdState }) {
  const { t, open, adText, setAdText, busy, error, note, bulk, toggleBulk, results, progress, bulkCount, submit, submitBulk, cancelRun, close } = ingest;
  if (!open) return null;
  // No entrance class of its own: JobsTab's section is `stagger-children`, which
  // already animates a newly-inserted direct child in (and would override one here).
  return (
    <div className="mt-4 rounded-lg border border-coral/30 bg-coral/5 p-3">
      <div className="flex items-start justify-between gap-2">
        <label htmlFor="ingest-ad" className="text-meta uppercase tracking-wide text-coral">
          {t("pasteHeading")}
        </label>
        {/* Second door out, on the corner the eye already checks for one. The
            Cancel button below still exists — it is the one that aborts a RUN. */}
        <button
          type="button"
          onClick={close}
          disabled={busy}
          aria-label={t("cancel")}
          title={t("cancel")}
          className="focus-ring -m-1 rounded-md p-1 text-steel hover:text-ink disabled:opacity-40"
        >
          <X size={15} aria-hidden />
        </button>
      </div>
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
