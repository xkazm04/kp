"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Select } from "@/app/_components/Select";
import { META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import { capabilityAwareReason, useErrorMessage } from "@/app/_lib/use-error-message";
import type { CalibrationRationale } from "@/app/_lib/dev-outcomes";
import { floorKey } from "./controlRoomConfirm";
import type { Guard, Outcome, OutcomeData } from "./types";

// The outcome vocabulary the API accepts. The VALUES are the wire codes and stay
// English; the labels come from `control.outcomes.value.*` (there is no shared
// `enums.*` row for this triple — it exists only on this console).
const OUTCOME_VALUES = ["hired", "rejected", "withdrawn"] as const;
const PERF_VALUES = [1, 2, 3, 4, 5] as const;

// Blank → undefined, but a legitimate "0" survives (Number("") === 0 would otherwise leak in).
function parseNum(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// The calibration engine reports WHICH of five fixed conclusions holds; the sentence
// is written here, in the operator's language. Same shape as the GitHub panel's
// findings (docs/architecture/localization.md).
function useRationaleText(): (r: CalibrationRationale) => string {
  const t = useTranslations("control.calibration.rationale");
  type RationaleKey = Parameters<typeof t>[0];
  return (r) => {
    const key = r.kind as RationaleKey;
    return t.has(key) ? t(key, r.params) : "";
  };
}

export function CalibrationPanel({
  data,
  armed,
  guard,
  reload,
  canGovern,
  canOperate,
}: {
  data: OutcomeData | null;
  armed: string | null;
  guard: Guard;
  /** Re-reads outcomes AND status — applying a floor changes both. */
  reload: () => Promise<void>;
  /** `org:manage` — the promote floor is one global key, i.e. deployment policy. */
  canGovern: boolean;
  /** `pipeline:write` — recording an outcome feeds the floor recommendation. */
  canOperate: boolean;
}) {
  const t = useTranslations("control");
  const rel = useRelativeTime();
  // Resolve API failures from the machine `code`, never from the server's English
  // `error` — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  const rationaleText = useRationaleText();

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ candidate: "", score: "", outcome: "hired", perf: "4" });
  // id of the recorded outcome currently picking a 1–5 performance score (one at a time).
  const [perfFor, setPerfFor] = useState<number | null>(null);

  // A legacy row can hold an outcome outside OUTCOME_VALUES; show the raw code rather
  // than nothing when the catalog has no label for it.
  const outcomeLabel = (value: string) => {
    const key = `outcomes.value.${value}` as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : value;
  };

  const recordOutcome = async () => {
    if (!form.candidate.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/devcase/outcomes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateRef: form.candidate.trim(),
          predictedScore: parseNum(form.score),
          outcome: form.outcome,
          performance: form.outcome === "hired" ? parseNum(form.perf) : undefined,
        }),
      });
      // Gate on r.ok: a failed write (validation, SQLITE_BUSY, 500) must not look like
      // success — keep the form intact so the recorded outcome isn't silently lost.
      if (!r.ok) {
        const p = (await r.json().catch(() => null)) as { error?: string; code?: string } | null;
        setErr(errMsg(p, t("outcomes.recordFailed", { status: r.status })));
        return;
      }
      setForm({ ...form, candidate: "", score: "" });
      await reload();
    } catch {
      setErr(t("outcomes.recordNetwork"));
    } finally {
      setBusy(false);
    }
  };

  // Attach an on-the-job performance score to an EXISTING recorded hire (auto-recorded
  // pipeline hires arrive without one). Posting the row's own ref/candidateRef makes the
  // store's upsert update that row in place — re-typing a known candidate into the
  // free-text form risked a duplicate decided row that calibrate() counted twice. The
  // form below stays for genuinely off-pipeline outcomes.
  const addPerformance = async (row: Outcome, perf: number) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/devcase/outcomes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ref: row.ref ?? undefined,
          candidateRef: row.candidateRef ?? undefined,
          outcome: "hired",
          performance: perf,
        }),
      });
      if (!r.ok) {
        const p = (await r.json().catch(() => null)) as { error?: string; code?: string } | null;
        setErr(errMsg(p, t("outcomes.perfFailed", { status: r.status })));
        return;
      }
      setPerfFor(null);
      await reload();
    } catch {
      setErr(t("outcomes.perfNetwork"));
    } finally {
      setBusy(false);
    }
  };

  // READ THE ANSWER, like the two handlers above it. This one moves the threshold every
  // future auto-decision is judged against, and it was the one that never checked: a
  // refused apply (403, a non-finite floor, SQLITE_BUSY) left the old floor in place
  // while the panel re-read and showed it, which reads as "the number I picked was
  // already the number".
  const applyFloor = async (floor: number) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/devcase/outcomes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ setFloor: floor }) });
      if (!r.ok) {
        const p = (await r.json().catch(() => null)) as { error?: string; code?: string; capability?: string } | null;
        setErr(capabilityAwareReason(errMsg, p, t("calibration.applyFailed", { status: r.status })));
        return;
      }
      await reload();
    } catch {
      setErr(t("calibration.applyNetwork"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-6">
      <h2 className={META_LABEL}>{t("outcomes.heading")}</h2>
      <p className="mt-1 max-w-2xl text-micro text-steel">{t("outcomes.blurb")}</p>

      {/* AUTHORITY (/perfect wave 21): recording an outcome is `pipeline:write`. The
          calibration READ below stays for every seat - it is the evidence an oversight
          reader came here for. */}
      {canOperate ? (
      <div className={`mt-2 flex flex-wrap items-center gap-1.5 p-2.5 ${PANEL}`}>
        {/* bug-ui-scan-2026-07-09 (guided-pipeline-simulation #5): a placeholder is
            not an accessible name (it vanishes once a value is typed) — name each
            field explicitly so a screen reader announces it recording an outcome. */}
        <input
          aria-label={t("outcomes.candidateLabel")}
          value={form.candidate}
          onChange={(e) => setForm({ ...form, candidate: e.target.value })}
          placeholder={t("outcomes.candidatePlaceholder")}
          className="focus-ring h-8 w-28 rounded border border-stone-200 bg-white px-2 text-micro text-ink caret-coral placeholder:text-steel"
        />
        <input
          aria-label={t("outcomes.scoreLabel")}
          value={form.score}
          onChange={(e) => setForm({ ...form, score: e.target.value })}
          placeholder={t("outcomes.scorePlaceholder")}
          className="focus-ring h-8 w-16 rounded border border-stone-200 bg-white px-2 text-micro text-ink caret-coral placeholder:text-steel"
        />
        <Select
          value={form.outcome}
          onChange={(v) => setForm({ ...form, outcome: v })}
          ariaLabel={t("outcomes.outcomeLabel")}
          sizeVariant="sm"
          className="h-8"
          options={OUTCOME_VALUES.map((x) => ({ value: x, label: outcomeLabel(x) }))}
        />
        {form.outcome === "hired" ? (
          <Select
            value={form.perf}
            onChange={(v) => setForm({ ...form, perf: v })}
            ariaLabel={t("outcomes.perfLabel")}
            sizeVariant="sm"
            className="h-8"
            options={PERF_VALUES.map((x) => ({ value: String(x), label: t("outcomes.perfOption", { n: x }) }))}
          />
        ) : null}
        <button type="button" onClick={recordOutcome} disabled={busy} className="focus-ring h-8 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
          {t("outcomes.record")}
        </button>
      </div>
      ) : null}

      {err ? (
        <p role="alert" className="mt-1.5 text-micro font-semibold text-coral">
          {err}
        </p>
      ) : null}

      {data ? (
        <div className={`mt-2 p-3 ${PANEL}`}>
          <div className="flex items-center gap-2 text-micro">
            <span className="text-steel">{t("calibration.activeFloor")}</span>
            <span className="font-serif text-lg text-ink">{data.activeFloor}</span>
            {canGovern && data.calibration.suggestedFloor != null && data.calibration.resolved >= 4 && data.calibration.suggestedFloor !== data.activeFloor ? (
              // bug-ui-scan-2026-07-09 (guided-pipeline-simulation #3): applying the
              // suggested floor changes the promote threshold for every future
              // auto-decision — gate it behind a confirm (two-step, lit while armed).
              // The armed key carries the VALUE (floorKey): the 3s poll can move
              // `suggestedFloor` between the arm and the confirm, and a constant key
              // let that second click apply a number the operator never confirmed.
              <button
                type="button"
                onClick={() => guard(floorKey(data.calibration.suggestedFloor!), () => applyFloor(data.calibration.suggestedFloor!))}
                disabled={busy}
                className={`focus-ring ml-auto h-7 rounded-md px-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 ${
                  armed === floorKey(data.calibration.suggestedFloor!) ? "bg-ink ring-2 ring-coral/40" : "bg-coral"
                }`}
              >
                {armed === floorKey(data.calibration.suggestedFloor!)
                  ? t("calibration.applyConfirm", { floor: data.calibration.suggestedFloor })
                  : t("calibration.applySuggested", { floor: data.calibration.suggestedFloor })}
              </button>
            ) : (
              <span className={`ml-auto ${META_LABEL}`}>{t("calibration.resolved", { count: data.calibration.resolved })}</span>
            )}
          </div>
          <table className="mt-2 w-full text-micro">
            <thead>
              <tr className={`text-left ${META_LABEL}`}>
                <th scope="col" className="py-1">{t("calibration.colBand")}</th>
                <th scope="col">{t("calibration.colN")}</th>
                <th scope="col">{t("calibration.colHireRate")}</th>
                <th scope="col">{t("calibration.colMeanPerf")}</th>
              </tr>
            </thead>
            <tbody>
              {data.calibration.bands.map((bnd) => (
                <tr key={bnd.label} className="border-t border-stone-100">
                  {/* The band label is a numeric range the engine mints ("55–69", "85+") — not copy. */}
                  <td className="py-1 font-mono text-ink">{bnd.label}</td>
                  <td className="text-steel">{bnd.count}</td>
                  <td className="text-ink">{bnd.hireRate != null ? t("calibration.percent", { pct: Math.round(bnd.hireRate * 100) }) : "—"}</td>
                  <td className="text-steel">{bnd.meanPerformance ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-micro text-ink">{rationaleText(data.calibration.rationale)}</p>
          {/* The engine reads the newest CALIBRATION_SCAN_LIMIT rows. When that cap
              actually bit, `resolved` describes a SUFFIX of this workspace's history, not
              all of it — and this is the screen whose button moves the live promote
              floor, so the sample it was computed from must not be overstated. Absent in
              the ordinary case: a caveat that did not bite is noise. */}
          {data.calibration.resolvedOf != null ? (
            <p className={`mt-1 ${META_LABEL}`}>{t("calibration.cappedNote", { limit: data.calibration.resolvedOf })}</p>
          ) : null}
        </div>
      ) : null}

      {/* Recorded outcomes — auto-recorded pipeline hires land here without a perf
          score; "add perf" updates the existing row (store upsert) so a known
          candidate never needs free-text re-entry that could double-count. */}
      {data && data.outcomes.length > 0 ? (
        <div className={`mt-2 p-3 ${PANEL}`}>
          <h3 className={META_LABEL}>{t("outcomes.recordedHeading", { count: Math.min(data.outcomes.length, 12) })}</h3>
          <table className="mt-1 w-full text-micro">
            <thead>
              <tr className={`text-left ${META_LABEL}`}>
                <th scope="col" className="py-1">{t("outcomes.colCandidate")}</th>
                <th scope="col">{t("outcomes.colScore")}</th>
                <th scope="col">{t("outcomes.colOutcome")}</th>
                <th scope="col">{t("outcomes.colPerf")}</th>
                <th scope="col">{t("outcomes.colRecorded")}</th>
              </tr>
            </thead>
            <tbody>
              {data.outcomes.slice(0, 12).map((row) => (
                <tr key={row.id} className="border-t border-stone-100">
                  {/* Provenance is the `source` FLAG, and the sentence is written HERE, in
                      the operator's language. This used to read the store's English
                      `note` two ways at once — printed raw as the tooltip, and
                      `startsWith("auto-recorded")` tested as if the prose were an enum. */}
                  <td className="py-1 font-semibold text-ink" title={t(`outcomes.sourceNote.${row.source}` as Parameters<typeof t>[0])}>
                    {row.candidateRef ?? row.ref ?? "—"}
                    {row.source === "auto" ? (
                      <span className="ml-1.5 rounded-full bg-coral/15 px-1.5 py-0.5 text-meta uppercase text-coral">{t("outcomes.autoBadge")}</span>
                    ) : null}
                  </td>
                  <td className="text-steel">{row.predictedScore ?? "—"}</td>
                  <td className="text-ink">{outcomeLabel(row.outcome)}</td>
                  <td className="text-steel">
                    {row.performance != null ? (
                      row.performance
                    ) : row.outcome === "hired" && canOperate ? (
                      perfFor === row.id ? (
                        // bug-ui-scan-2026-07-09 (guided-pipeline-simulation #5): name
                        // the rating group and each digit so an SR announces "Rate
                        // performance 3 of 5", not a bare "3".
                        <span role="group" aria-label={t("outcomes.ratingGroup")} className="inline-flex items-center gap-1">
                          {PERF_VALUES.map((p) => (
                            <button
                              key={p}
                              type="button"
                              disabled={busy}
                              aria-label={t("outcomes.ratePerformance", { n: p })}
                              onClick={() => void addPerformance(row, p)}
                              className="focus-ring h-6 w-6 rounded border border-stone-200 bg-white text-micro font-semibold text-ink hover:border-moss/50 hover:bg-moss/5 disabled:opacity-50"
                            >
                              {p}
                            </button>
                          ))}
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setPerfFor(row.id)}
                          className="focus-ring rounded border border-stone-200 bg-white px-1.5 py-0.5 text-micro font-semibold text-steel hover:text-ink disabled:opacity-50"
                        >
                          {t("outcomes.addPerf")}
                        </button>
                      )
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="text-micro text-steel">{rel(row.recordedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
