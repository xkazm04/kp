"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock, Loader2, ListChecks, RefreshCw, Sparkles } from "lucide-react";
import { Modal } from "@/app/_components/Modal";
import { Meter } from "@/app/_components/Meter";
import { PrepSourceBadge, isPrepFallback } from "@/app/_components/Badge";
import { useTasks, useTaskResult } from "@/app/features/tasks/TasksProvider";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import type { SchedEntry } from "./ScheduleTypes";

type Block = { fromMin: number; toMin: number; topic: string; goal: string; questions: string[]; followUp?: string };
type Prep = { scenario: string; durationMin: number; focusAreas: string[]; chronology: Block[]; signals: string[]; source?: string };

export function InterviewPrepModal({ entry, onClose }: { entry: SchedEntry; onClose: () => void }) {
  const { startTask } = useTasks();
  // Load any saved artifact via the shared hook (handles non-OK status, an {error}
  // body, and unmount). A load FAILURE now surfaces as a distinct error+retry state
  // (idea-bc78b8f5), never collapsed into the "none yet" empty state.
  const { data, error, reload } = useJsonFetch<{ prep?: { payload?: Prep } }>(
    `/api/interview-prep?entry=${encodeURIComponent(entry.id)}`,
    "Couldn't load this candidate's saved prep."
  );
  const [generated, setGenerated] = useState<Prep | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  // A completed (re)generation (`generated`) ALWAYS supersedes the fetched copy, so
  // a slow initial GET resolving after a fast generation can't wipe a freshly saved
  // plan back to the empty state — the stale-GET race (idea-73f7b1a0).
  const prep = generated ?? data?.prep?.payload ?? null;
  // The hook starts with data === null; once it resolves (an artifact, an empty
  // body, or an error) we're no longer waiting on the initial load.
  const loading = data === null && error === null;
  // A deterministic template fallback (LLM unavailable) is generic, not tailored —
  // disclosed below with a prompt to regenerate (idea-0864adb5).
  const fallback = prep ? isPrepFallback(prep.source) : false;

  // Watch a generation task; its result (fetched on demand — the poll omits it)
  // supersedes any saved artifact. Hold taskId until the full result lands so the
  // "Generating…" state persists through the brief fetch, then clear it.
  const { status: genStatus, full: genFull } = useTaskResult(taskId);
  useEffect(() => {
    if (!taskId) return;
    if (genStatus === "succeeded") {
      if (genFull) {
        setGenerated((genFull.result as Prep) ?? null);
        setTaskId(null);
      }
    } else if (genStatus === "failed" || genStatus === "canceled" || genStatus === "interrupted") {
      setTaskId(null);
    }
  }, [taskId, genStatus, genFull]);

  const generate = async () => {
    setChecked({});
    const t = await startTask("interview_prep", { entryId: entry.id, candidateLabel: entry.candidateLabel, jobTitle: entry.jobTitle });
    if (t) setTaskId(t.id);
  };
  const generating = taskId !== null;

  // The chronology blocks plus the flat "Signals to confirm" list are the checkable
  // items; `?? []` only guards a malformed payload, not a second group shape.
  const signals = prep?.signals ?? [];
  const totalItems = useMemo(
    () => (prep ? prep.chronology.length + signals.length : 0),
    [prep, signals]
  );
  const doneItems = Object.values(checked).filter(Boolean).length;

  return (
    <Modal
      title={`Interview prep · ${entry.candidateLabel}`}
      subtitle={entry.jobTitle ?? undefined}
      onClose={onClose}
      size="3xl"
      footer={
        prep ? (
          <button
            type="button"
            onClick={generate}
            disabled={generating}
            className="focus-ring inline-flex h-9 items-center gap-1 rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:border-coral/40 disabled:opacity-50"
          >
            <RefreshCw size={14} /> {generating ? "Generating…" : "Regenerate"}
          </button>
        ) : null
      }
    >
      {loading ? (
        <p className="text-sm text-steel">Loading…</p>
      ) : generating && !prep ? (
        <p className="flex items-center gap-2 text-sm text-steel">
          <Loader2 size={16} className="animate-spin text-coral" /> Designing the interview plan from the CV&apos;s recommended questions…
        </p>
      ) : error && !prep ? (
        // Distinct failure state: a 500 / DB lock / parse error must never read as
        // "no prep yet". Offer a retry (re-fetch) and a generate-fresh path.
        <div className="text-center">
          <p className="flex items-center justify-center gap-2 text-sm text-coral">
            <AlertTriangle size={15} /> {error}
          </p>
          <p className="mt-1 text-meta text-steel">This is a load error, not an empty candidate — retry, or generate a fresh plan.</p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={reload}
              className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:border-coral/40"
            >
              <RefreshCw size={14} /> Retry
            </button>
            <button
              type="button"
              onClick={generate}
              disabled={generating}
              className="focus-ring inline-flex h-9 items-center gap-2 rounded-md bg-coral px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              <Sparkles size={16} /> Generate
            </button>
          </div>
        </div>
      ) : !prep ? (
        <div className="text-center">
          <p className="text-sm text-steel">No interview prep generated yet for this candidate.</p>
          <button
            type="button"
            onClick={generate}
            className="focus-ring mt-3 inline-flex h-10 items-center gap-2 rounded-md bg-coral px-4 text-sm font-semibold text-white hover:opacity-90"
          >
            <Sparkles size={16} /> Generate interview prep
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              {/* Provenance: AI-tailored vs deterministic template fallback. */}
              <PrepSourceBadge source={prep.source} />
              <span className="nums shrink-0 rounded-md bg-paper px-2 py-1 text-sm font-semibold text-coral">{doneItems}/{totalItems} done</span>
            </div>
            {fallback ? (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-800">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                <span>
                  Built from a generic template because the AI model was unavailable — these questions aren&apos;t tailored to this candidate.{" "}
                  <button
                    type="button"
                    onClick={generate}
                    disabled={generating}
                    className="font-semibold underline underline-offset-2 hover:text-amber-900 disabled:opacity-50"
                  >
                    {generating ? "Regenerating…" : "Regenerate with AI"}
                  </button>
                </span>
              </div>
            ) : null}
            <p className="text-base text-ink">{prep.scenario}</p>
            {/* Ambient coverage bar: fills moss (score-strong) as topics/signals check off,
                so the interviewer can read progress without breaking eye contact. */}
            <Meter
              value={totalItems ? (doneItems / totalItems) * 100 : 0}
              tone="strong"
              aria-label={`Interview coverage: ${doneItems} of ${totalItems} items checked`}
            />
          </div>

          {/* Run of show — the timed plan, checkable topic-by-topic during the interview. */}
          <section>
            <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
              <Clock size={13} /> Run of show · {prep.durationMin} min
            </p>
            <ol className="mt-2 space-y-1.5">
              {prep.chronology.map((b, i) => {
                const key = `c-${i}`;
                const on = Boolean(checked[key]);
                return (
                  <li key={key} className={`rounded-md border p-2.5 transition-colors ${on ? "border-moss/40 bg-moss/5" : "border-stone-200"}`}>
                    <label className="flex cursor-pointer items-start gap-2.5">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => setChecked((s) => ({ ...s, [key]: e.target.checked }))}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-coral"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className={`text-sm font-semibold ${on ? "text-steel line-through" : "text-ink"}`}>{b.topic}</span>
                          <span className="shrink-0 rounded bg-paper px-1.5 py-0.5 text-sm nums text-steel">{b.fromMin}–{b.toMin} min</span>
                        </span>
                        <span className="mt-0.5 block text-sm text-steel">{b.goal}</span>
                        {b.questions.map((q, j) => (
                          <span key={j} className="mt-1 block text-sm text-ink">“{q}”</span>
                        ))}
                        {b.followUp ? <span className="mt-0.5 block text-sm text-steel">↳ Follow-up: {b.followUp}</span> : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ol>
          </section>

          {/* Cross-cutting signals to confirm — one flat list under a static heading. */}
          {signals.length ? (
            <section>
              <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
                <ListChecks size={13} /> Signals to confirm
              </p>
              <ul className="mt-1.5 space-y-1">
                {signals.map((it, ii) => {
                  const key = `k-${ii}`;
                  return (
                    <li key={key}>
                      <label className="flex cursor-pointer items-start gap-2 text-sm text-ink">
                        <input
                          type="checkbox"
                          checked={Boolean(checked[key])}
                          onChange={(e) => setChecked((s) => ({ ...s, [key]: e.target.checked }))}
                          className="mt-0.5 h-4 w-4 shrink-0 accent-coral"
                        />
                        <span className={checked[key] ? "text-steel line-through" : ""}>{it}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
