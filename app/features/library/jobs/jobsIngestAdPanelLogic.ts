// State + submit logic for JobsIngestAdPanel.tsx — extracted verbatim (no
// behaviour change) so the panel file stays under the 200-line split threshold.
// Owns: the open/closed panel state, the bulk toggle, the single-ad and
// bulk-ad submit flows (both routed through the same hardened ingestOne call),
// and the abort-on-unmount teardown.
"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { MIN_AD_CHARS, splitJobAds } from "@/app/_lib/split-ads";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { foldJsonResponse } from "./jobsResponseFold";
// The cancel-versus-unmount protocol and the keep-the-paste rule, as a pure
// decision — pinned by jobsIngestRunOutcome.test.ts (a hook can't be rendered by
// `node --test`, so the rules that matter live where a test can reach them).
import {
  releasesBusy,
  settleBulkRun,
  settleSingleRun,
  type IngestRow,
  type RowStatus,
} from "./jobsIngestRunOutcome";

export type { RowStatus };
const firstLine = (ad: string) => (ad.split(/\r?\n/)[0] ?? "").slice(0, 60).trim() || "—";

export type IngestResult = { jobId: string; created: boolean; title: string };

export function useIngestAdPanelLogic({
  onIngested,
  onBulkComplete,
}: {
  onIngested?: (result: IngestResult) => void;
  onBulkComplete?: () => void;
}) {
  const t = useTranslations("jobs.ingest");
  // Ingest failures resolve from the machine `code`, never the server's English
  // `error` string — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  const [open, setOpen] = useState(false);
  const [adText, setAdText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // efb12f90 — bulk paste: many ads separated by a line of dashes, imported in one
  // pass with a per-row result table.
  const [bulk, setBulk] = useState(false);
  const [results, setResults] = useState<{ title: string; status: RowStatus }[] | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Distinguishes the two reasons a controller aborts. An UNMOUNT abort must stay
  // silent (no state writes into a dead component); a USER cancel must land like any
  // other terminal outcome — clear busy, keep the panel open, keep the partial
  // results, and say what happened. Without this flag every abort was treated as a
  // teardown, which is why the run could never be cancelled from the mounted panel.
  const cancelledRef = useRef(false);
  const bulkCount = bulk ? splitJobAds(adText).length : 0;

  // Abort an in-flight parse if the panel unmounts (tab switch) — otherwise the
  // fetch + its Claude CLI child outlive a result nobody will read.
  useEffect(() => () => abortRef.current?.abort(), []);

  // The single hardened POST /api/jobs/ingest call both the single-ad and the bulk
  // paths run (bulk is just this in a loop over the split ads). Shares the fetch +
  // response decode; the abort signal is threaded through so a teardown SIGKILLs the
  // child. Returns a discriminated result — never throws — so each caller maps it to
  // its own UI (an inline note vs. a per-row status).
  const ingestOne = async (
    text: string,
    signal: AbortSignal
  ): Promise<{ ok: true; result: IngestResult } | { ok: false; error: string }> => {
    const res = await fetch("/api/jobs/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adText: text }),
      signal,
    });
    // Guarded decode: a proxy's HTML 502 used to throw a SyntaxError out of the
    // bare `res.json()` and paint "Unexpected token '<'" into the panel, in
    // English, in every locale. The fold answers a code (or a localized line).
    const body = (await res.json().catch(() => null)) as unknown;
    const fold = foldJsonResponse<{ jobId: string; created?: boolean; title?: string }>(
      res,
      body,
      (p) => typeof (p as { jobId?: unknown }).jobId === "string"
    );
    if (fold.kind === "failed") {
      return { ok: false, error: errMsg(fold.payload, t("ingestFailedStatus", { status: res.status })) };
    }
    // A 200 with no jobId is not a coded refusal — there is no code to resolve.
    if (fold.kind === "malformed") return { ok: false, error: t("malformedResponse") };
    const data = fold.data;
    return { ok: true, result: { jobId: data.jobId, created: Boolean(data.created), title: data.title ?? t("defaultTitle") } };
  };

  const submit = async () => {
    const text = adText.trim();
    if (text.length < MIN_AD_CHARS) {
      setError(t("minChars", { min: MIN_AD_CHARS }));
      return;
    }
    setBusy(true);
    setError(null);
    setNote(null);
    // bug-ui-scan-2026-07-09 (job-postings-lifecycle #4): drop any prior bulk run's
    // per-row table + progress so a single add doesn't render a stale results list
    // beneath its own note.
    setResults(null);
    setProgress(null);
    const controller = new AbortController();
    abortRef.current = controller;
    cancelledRef.current = false;
    try {
      const outcome = await ingestOne(text, controller.signal);
      if (!outcome.ok) throw new Error(outcome.error);
      const { result } = outcome;
      setNote(
        result.created
          ? t("added", { title: result.title })
          : t("alreadyExists", { title: result.title })
      );
      setAdText("");
      onIngested?.(result);
    } catch (caught) {
      const settled = settleSingleRun({
        aborted: controller.signal.aborted,
        cancelled: cancelledRef.current,
      });
      // User cancel: report it (the paste is kept so the ad isn't lost). Unmount
      // teardown: stay silent — the component is gone.
      if (settled.kind === "cancelled") setNote(t("cancelled"));
      if (settled.kind !== "settled") return;
      setError(caught instanceof Error ? caught.message : t("ingestFailed"));
    } finally {
      if (releasesBusy({ aborted: controller.signal.aborted, cancelled: cancelledRef.current })) setBusy(false);
      abortRef.current = null;
    }
  };

  // efb12f90 — import each pasted ad through the SAME hardened single-ingest route
  // (content-hash dedup → "already in catalog"), sequentially, with a per-row
  // result table. Sequential keeps one Claude parse in flight at a time and lets a
  // cancel mid-run stop cleanly.
  const submitBulk = async () => {
    const ads = splitJobAds(adText);
    if (ads.length === 0) {
      setError(t("minChars", { min: MIN_AD_CHARS }));
      return;
    }
    setBusy(true);
    setError(null);
    setNote(null);
    setResults([]);
    const controller = new AbortController();
    abortRef.current = controller;
    cancelledRef.current = false;
    const out: IngestRow[] = [];
    try {
      for (let i = 0; i < ads.length; i += 1) {
        setProgress({ done: i, total: ads.length });
        try {
          const outcome = await ingestOne(ads[i], controller.signal);
          if (!outcome.ok) {
            out.push({ title: firstLine(ads[i]), status: "failed" });
          } else {
            const { result } = outcome;
            out.push({ title: result.title, status: result.created ? "added" : "exists" });
          }
        } catch {
          if (controller.signal.aborted) break; // cancel/teardown — settled after the loop
          out.push({ title: firstLine(ads[i]), status: "failed" });
        }
        setResults([...out]);
      }
      // A cancelled run is a real terminal outcome, not a failure: keep the rows that
      // did land, say how far it got, and refresh the corpus if anything was created.
      // (Unmount teardown falls through here silently — no state writes.)
      // The three-way decision is settleBulkRun's; this block only APPLIES it, so
      // the rule is pinned by jobsIngestRunOutcome.test.ts rather than by nothing.
      const settled = settleBulkRun({
        aborted: controller.signal.aborted,
        cancelled: cancelledRef.current,
        rows: out,
        total: ads.length,
      });
      if (settled.kind === "teardown") return;
      if (settled.kind === "cancelled") {
        setResults(settled.results);
        setNote(t("bulkCancelled", { done: settled.done, total: settled.total }));
        if (settled.refresh) onBulkComplete?.();
        return;
      }
      const { added, exists, failed } = settled;
      setNote(t("bulkDone", { added, exists, failed }));
      // One coalesced refresh after the whole run (only if something new landed) — no
      // per-row reload storm, and no auto-open modal over the results table.
      //
      // added === 0 (every ad a dedup hit or a parse failure) used to clear the paste
      // AND skip the refresh: the user's input vanished with nothing new on screen to
      // account for it. The paste is the only copy of that text — keep it so the failed
      // ads can be fixed and re-run; the bulkDone note + the per-row table carry the
      // outcome.
      if (settled.clearPaste) setAdText("");
      if (settled.refresh) onBulkComplete?.();
    } finally {
      if (releasesBusy({ aborted: controller.signal.aborted, cancelled: cancelledRef.current })) {
        setBusy(false);
        setProgress(null);
      }
      abortRef.current = null;
    }
  };

  // Cancel a RUNNING import. A bulk import is minutes of billed LLM time per ad;
  // this ABORTS the run (the signal is threaded to the route, which SIGKILLs the
  // parser child) and leaves the panel + partial results standing.
  const cancelRun = () => {
    cancelledRef.current = true;
    abortRef.current?.abort();
  };

  const close = () => {
    abortRef.current?.abort();
    setOpen(false);
    setAdText("");
    setError(null);
    setNote(null);
    // #4: reopening the panel must not show the previous run's rows or a
    // frozen progress label — reset the transient run state on close too.
    setResults(null);
    setProgress(null);
  };

  const toggleBulk = (checked: boolean) => {
    setBulk(checked);
    // #4: switching single⇄bulk makes the prior run's results/progress
    // (and note/error) unrelated to the new mode — clear them.
    setResults(null);
    setProgress(null);
    setNote(null);
    setError(null);
  };

  return {
    t,
    open,
    setOpen,
    adText,
    setAdText,
    busy,
    error,
    note,
    bulk,
    toggleBulk,
    results,
    progress,
    bulkCount,
    submit,
    submitBulk,
    cancelRun,
    close,
  };
}
