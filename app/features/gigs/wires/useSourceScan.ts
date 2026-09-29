"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import { useTasks, useTaskResult } from "@/app/features/shell/tasks/TasksProvider";
import { sourceScanView } from "../logic/scan";
import type { SourceRow } from "../logic/wire";
import { sendJson } from "../data/useGigsData";
import type { Key } from "./wireConfig";

/** One source's own scan: start it, follow its task through the workspace's task poll
 *  (useTaskResult, the record the Background tasks tab shows) to its outcome, and re-read
 *  the sources and the gigs once when it ends. Two clicks never start two scans: the
 *  button is inert from the click until the task ends (and the door folds a repeat onto
 *  the running task anyway). A click on a blocked scan says why, in the row's line. */
export function useSourceScan(source: SourceRow, blocked: string | null, onScanned: () => Promise<unknown>) {
  const t = useTranslations("gigs");
  const resolveError = useErrorMessage();
  const { refresh } = useTasks();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [nudged, setNudged] = useState(false);
  const watch = useTaskResult(taskId);
  // Between the 202 and the poll's first sight of the task, the status is unknown: queued.
  const awaitingPoll = taskId !== null && watch.status === null;
  const inFlight = starting || awaitingPoll || watch.active || watch.loading;
  const ended = taskId !== null && (watch.full !== null || watch.resultUnavailable) ? taskId : null;

  const reloadedFor = useRef<string | null>(null);
  const onScannedRef = useRef(onScanned);
  useEffect(() => {
    onScannedRef.current = onScanned;
  });
  useEffect(() => {
    if (!ended || reloadedFor.current === ended) return;
    reloadedFor.current = ended;
    void onScannedRef.current();
  }, [ended]);

  async function start() {
    if (inFlight || blocked) return;
    setStarting(true);
    setStartError(null);
    setNudged(false);
    const res = await sendJson("/api/gigs/scan", "POST", { sourceId: source.id });
    setStarting(false);
    const id = res.ok && typeof res.body?.taskId === "string" ? res.body.taskId : null;
    if (!id) {
      setStartError(resolveError(res.body as ApiErrorPayload | null, t("scan.failed")));
      return;
    }
    setTaskId(id);
    refresh();
  }

  let line: { tone: "info" | "critical" | "quiet"; text: string } | null = null;
  if (startError) line = { tone: "critical", text: startError };
  else if (starting) line = { tone: "quiet", text: t("sources.scanStarting") };
  else if (awaitingPoll || watch.status === "queued") line = { tone: "quiet", text: t("sources.scanQueued") };
  else if (watch.status === "running") line = { tone: "quiet", text: watch.progressMsg || t("sources.scanRunning", { host: source.host }) };
  else if (watch.loading) line = { tone: "quiet", text: t("sources.scanReading") };
  else if (watch.status === "failed" || watch.status === "canceled" || watch.status === "interrupted") {
    line = { tone: "critical", text: t("sources.scanFailed", { status: t(`sources.scanStatus.${watch.status}` as Key) }) };
  } else if (watch.resultUnavailable) line = { tone: "info", text: t("sources.scanUnknown") };
  else if (watch.full) {
    const view = sourceScanView(watch.full.result, source.id);
    if (view.kind === "ran") {
      const outcome = t(`runOutcome.${view.outcome}` as Key);
      const reasonKey = `sources.scanReason.${view.reason ?? ""}` as Key;
      const reason = view.reason ? (t.has(reasonKey) ? t(reasonKey) : view.reason.replace(/_/g, " ")) : null;
      line = {
        tone: view.outcome === "succeeded" ? "info" : "critical",
        text: reason ? t("sources.scanDoneReason", { outcome, reason, created: view.created, found: view.found }) : t("sources.scanDone", { outcome, created: view.created, found: view.found }),
      };
    } else if (view.kind === "not_run") line = { tone: "info", text: t("sources.scanNotRun") };
    else line = { tone: "info", text: t("sources.scanUnknown") };
  } else if (nudged && blocked) line = { tone: "quiet", text: blocked };

  const finishedAt = watch.full?.finishedAt && !inFlight && !startError ? watch.full.finishedAt : null;
  return { start, inFlight, line, finishedAt, nudge: () => setNudged(true) };
}
