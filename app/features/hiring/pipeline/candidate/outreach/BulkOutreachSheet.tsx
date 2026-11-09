"use client";

// The bulk dry-run sheet for batch outreach (comms scope C2b, second half). A batch outreach
// only DRAFTS: one held letter per candidate. This sheet lists the cohort's held letters
// (the exact rendered letter, footers included, each with its own delivery forecast and
// state), forecasts the cohort as a whole, lets a person edit any letter, and then approves
// and releases the batch through the same per-letter doors the release card uses. Nothing
// here sends by itself: the button is the one deliberate act, and every letter is its own
// request. Keyless, the cohort reads "queued" and no network call leaves.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { TextArea } from "@/app/_components/TextArea";
import { TextInput } from "@/app/_components/TextInput";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CHIP_QUIET, NOTICE } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { editLetter, type OutreachLetterView } from "./outreachCard";
import {
  approveAndReleaseCohort,
  cohortForecast,
  forecastKind,
  isSettled,
  loadCohort,
  refuseReason,
  tallyResults,
  type BulkLetterResult,
  type CohortLetter,
} from "./outreachBulk";

type Draft = { subject: string; body: string };

export function BulkOutreachSheet({
  entryIds,
  labels,
  onClose,
  onDone,
}: {
  entryIds: readonly string[];
  /** Optional display name per application id (the board already knows them). */
  labels?: Readonly<Record<string, string>>;
  onClose: () => void;
  /** Called once a bulk run finished, so the board can refresh. */
  onDone?: () => void;
}) {
  const t = useTranslations("pipeline.candidate.outreach");
  const errorMessage = useErrorMessage();
  const [rows, setRows] = useState<CohortLetter[] | null>(null);
  const [editing, setEditing] = useState<{ entryId: string; draft: Draft } | null>(null);
  const [rowNote, setRowNote] = useState<Record<string, { kind: "stale" } | { kind: "error"; text: string }>>({});
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<BulkLetterResult[] | null>(null);

  const reload = useCallback(() => {
    setRows(null);
    void loadCohort(entryIds).then(setRows);
  }, [entryIds]);
  useEffect(() => {
    let live = true;
    void loadCohort(entryIds).then((next) => {
      if (live) setRows(next);
    });
    return () => {
      live = false;
    };
  }, [entryIds]);

  const forecast = useMemo(() => (rows ? cohortForecast(rows) : null), [rows]);
  const actionable = forecast ? forecast.send + forecast.queue + forecast.refuse : 0;
  const running = progress !== null;
  const resultByEntry = useMemo(() => new Map((results ?? []).map((r) => [r.entryId, r])), [results]);

  const reasonWord = (reason: string) => t("bulk.reason", { reason });

  const save = async (row: CohortLetter & { view: OutreachLetterView }) => {
    if (!editing) return;
    setSaving(true);
    // The revision this sheet RENDERED: an edit of a letter someone else already changed is refused.
    const out = await editLetter(row.view.letter.id, { revision: row.view.letter.revision, ...editing.draft });
    setSaving(false);
    if (out.kind === "ok") {
      setRows((all) => all?.map((r) => (r.entryId === row.entryId ? { entryId: r.entryId, view: out.view } : r)) ?? all);
      setRowNote((n) => Object.fromEntries(Object.entries(n).filter(([k]) => k !== row.entryId)));
      setEditing(null);
    } else if (out.kind === "stale") {
      setRowNote((n) => ({ ...n, [row.entryId]: { kind: "stale" } }));
    } else {
      setRowNote((n) => ({ ...n, [row.entryId]: { kind: "error", text: errorMessage(out.error, t("actionFailed")) } }));
    }
  };

  const run = async () => {
    if (!rows || running) return;
    setEditing(null);
    setProgress({ done: 0, total: actionable });
    const out = await approveAndReleaseCohort(rows, fetch, (done, total) => setProgress({ done, total }));
    setResults(out);
    setProgress(null);
    onDone?.();
  };

  const tally = results ? tallyResults(results) : null;

  return (
    <Modal
      title={t("bulk.title", { count: entryIds.length })}
      subtitle={t("bulk.intro")}
      onClose={onClose}
      size="3xl"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={onClose} className={`${BTN_GHOST} h-9 cursor-pointer px-4 text-meta`}>
            {t("bulk.close")}
          </button>
          {results ? null : (
            <button
              type="button"
              onClick={() => void run()}
              disabled={!rows || running || actionable === 0 || editing !== null}
              aria-busy={running}
              className={`${BTN_PRIMARY} h-9 cursor-pointer px-4 text-meta disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {running && progress ? t("bulk.running", { done: progress.done, total: progress.total }) : t("bulk.approveRelease", { count: actionable })}
            </button>
          )}
        </div>
      }
    >
      {!rows || !forecast ? (
        <p role="status" className="text-meta text-steel">
          {t("bulk.loading")}
        </p>
      ) : (
        <div className="space-y-3">
          <div className={`${NOTICE("amber")} space-y-0.5 px-3 py-2 text-meta`} role="status" aria-label={t("bulk.forecastTitle")}>
            <p className="font-semibold text-ink">{t("bulk.forecastTitle")}</p>
            {forecast.send > 0 ? <p>{t("bulk.forecastSend", { count: forecast.send })}</p> : null}
            {forecast.queue > 0 ? <p>{t("bulk.forecastQueue", { count: forecast.queue })}</p> : null}
            {forecast.refuse > 0 ? (
              <p>
                {t("bulk.forecastRefuse", { count: forecast.refuse })}{" "}
                {Object.entries(forecast.refuseReasons)
                  .map(([reason, n]) => `${reasonWord(reason)} (${n})`)
                  .join(", ")}
              </p>
            ) : null}
            {forecast.settled > 0 ? <p>{t("bulk.forecastSettled", { count: forecast.settled })}</p> : null}
            {forecast.missing > 0 ? <p>{t("bulk.forecastMissing", { count: forecast.missing })}</p> : null}
          </div>

          {tally ? (
            <p role="status" className={`${NOTICE("amber")} px-3 py-2 text-meta`}>
              {t("bulk.summary", tally)}
            </p>
          ) : null}

          <ul className="space-y-3">
            {rows.map((row) => {
              const name = labels?.[row.entryId] ?? row.entryId;
              if (!row.view) {
                return (
                  <li key={row.entryId} className="text-meta text-steel">
                    <span className="font-semibold text-ink">{name}</span> · {row.loadFailed ? t("bulk.loadFailedRow") : t("bulk.noLetter")}
                  </li>
                );
              }
              const { letter, preview } = row.view;
              const result = resultByEntry.get(row.entryId);
              const kind = forecastKind(preview);
              const isEditing = editing?.entryId === row.entryId;
              const note = rowNote[row.entryId];
              return (
                <li key={row.entryId} className="space-y-2 rounded-md border border-stone-200 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-meta">
                    <span className="font-semibold text-ink">{name}</span>
                    <span className={CHIP_QUIET}>{t(`state.${letter.state}`)}</span>
                    {isSettled(letter.state) ? null : (
                      <span className="text-steel">
                        {kind === "send"
                          ? t("bulk.rowSend")
                          : kind === "queue"
                            ? t("bulk.rowQueue")
                            : t("bulk.rowRefuse", { reason: reasonWord(refuseReason(preview)) })}
                      </span>
                    )}
                    {result ? (
                      <span className="font-semibold text-ink">
                        {result.kind === "refused" ? t("bulk.result.refused", { reason: reasonWord(result.reason) }) : t(`bulk.result.${result.kind}`)}
                      </span>
                    ) : null}
                  </div>

                  {isEditing ? (
                    <div className="space-y-2">
                      <TextInput
                        sizeVariant="sm"
                        aria-label={t("bulk.subjectLabel")}
                        value={editing.draft.subject}
                        onChange={(e) => setEditing({ entryId: row.entryId, draft: { ...editing.draft, subject: e.target.value } })}
                      />
                      <TextArea
                        aria-label={t("bulk.bodyLabel")}
                        rows={8}
                        value={editing.draft.body}
                        onChange={(e) => setEditing({ entryId: row.entryId, draft: { ...editing.draft, body: e.target.value } })}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void save({ ...row, view: row.view! })}
                          disabled={saving}
                          className={`${BTN_SECONDARY} h-8 cursor-pointer px-3 text-meta disabled:opacity-50`}
                        >
                          {saving ? t("bulk.saving") : t("bulk.save")}
                        </button>
                        <button type="button" onClick={() => setEditing(null)} className={`${BTN_GHOST} h-8 cursor-pointer px-3 text-meta`}>
                          {t("bulk.cancel")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-md border border-stone-200 bg-white p-2.5" lang={preview.locale}>
                      <p className="text-meta text-steel">{preview.recipient ? t("letterTo", { recipient: preview.recipient }) : t("letterNoRecipient")}</p>
                      <p className="mt-1 text-meta font-semibold text-ink">{t("letterSubject", { subject: preview.subject })}</p>
                      <p className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-meta text-ink">{preview.body}</p>
                    </div>
                  )}

                  {note ? (
                    <p role="alert" className={`${NOTICE(note.kind === "stale" ? "amber" : "critical")} px-2 py-1.5 text-meta`}>
                      {note.kind === "stale" ? t("stale") : note.text}{" "}
                      {note.kind === "stale" ? (
                        <button type="button" onClick={reload} className={`${BTN_GHOST} h-8 cursor-pointer px-2 text-meta underline`}>
                          {t("reload")}
                        </button>
                      ) : null}
                    </p>
                  ) : null}

                  {!isEditing && letter.state === "drafted" && !running && !results ? (
                    <button
                      type="button"
                      onClick={() => setEditing({ entryId: row.entryId, draft: { subject: letter.subject ?? "", body: letter.body ?? "" } })}
                      className={`${BTN_GHOST} h-8 cursor-pointer px-2 text-meta underline`}
                    >
                      {t("bulk.edit")}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Modal>
  );
}
