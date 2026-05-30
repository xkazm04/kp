"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock, Loader2, ListChecks, RefreshCw, Sparkles } from "lucide-react";
import { Modal } from "@/app/_components/Modal";
import { useTasks } from "@/app/features/tasks/TasksProvider";
import type { SchedEntry } from "./ScheduleTypes";

type Block = { fromMin: number; toMin: number; topic: string; goal: string; questions: string[]; followUp?: string };
type Group = { group: string; items: string[] };
type Prep = { scenario: string; durationMin: number; focusAreas: string[]; chronology: Block[]; checklist: Group[]; source?: string };

export function InterviewPrepModal({ entry, onClose }: { entry: SchedEntry; onClose: () => void }) {
  const { startTask, tasks } = useTasks();
  const [prep, setPrep] = useState<Prep | null>(null);
  const [loading, setLoading] = useState(true);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  // Load any saved artifact for this entry.
  useEffect(() => {
    let alive = true;
    fetch(`/api/interview-prep?entry=${encodeURIComponent(entry.id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((p) => alive && setPrep((p.prep?.payload as Prep) ?? null))
      .catch(() => alive && setPrep(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [entry.id]);

  // Poll a generation task.
  useEffect(() => {
    if (!taskId) return;
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    if (t.status === "succeeded") {
      setPrep((t.result as Prep) ?? null);
      setTaskId(null);
    } else if (t.status === "failed" || t.status === "canceled" || t.status === "interrupted") {
      setTaskId(null);
    }
  }, [tasks, taskId]);

  const generate = async () => {
    setChecked({});
    const t = await startTask("interview_prep", { entryId: entry.id, candidateLabel: entry.candidateLabel, jobTitle: entry.jobTitle });
    if (t) setTaskId(t.id);
  };
  const generating = taskId !== null;

  const totalItems = useMemo(() => (prep?.checklist ?? []).reduce((n, g) => n + g.items.length, 0), [prep]);
  const doneItems = Object.values(checked).filter(Boolean).length;

  return (
    <Modal
      title={`Interview prep · ${entry.candidateLabel}`}
      subtitle={entry.jobTitle ?? undefined}
      onClose={onClose}
      size="2xl"
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
          <p className="text-base text-ink">{prep.scenario}</p>

          <section>
            <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
              <Clock size={13} /> Run of show · {prep.durationMin} min
            </p>
            <ol className="mt-2 space-y-1.5">
              {prep.chronology.map((b, i) => (
                <li key={i} className="rounded-md border border-stone-200 p-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-ink">{b.topic}</span>
                    <span className="shrink-0 rounded bg-paper px-1.5 py-0.5 text-sm tabular-nums text-steel">{b.fromMin}–{b.toMin} min</span>
                  </div>
                  <p className="mt-0.5 text-sm text-steel">{b.goal}</p>
                  {b.questions.map((q, j) => (
                    <p key={j} className="mt-1 text-sm text-ink">“{q}”</p>
                  ))}
                  {b.followUp ? <p className="mt-0.5 text-sm text-steel">↳ Follow-up: {b.followUp}</p> : null}
                </li>
              ))}
            </ol>
          </section>

          <section>
            <p className="flex items-center justify-between text-meta uppercase tracking-wide text-steel">
              <span className="flex items-center gap-1.5"><ListChecks size={13} /> Live checklist</span>
              <span className="text-coral">{doneItems}/{totalItems}</span>
            </p>
            <div className="mt-2 space-y-2">
              {prep.checklist.map((g, gi) => (
                <div key={gi}>
                  <p className="text-sm font-semibold text-ink">{g.group}</p>
                  <ul className="mt-1 space-y-1">
                    {g.items.map((it, ii) => {
                      const key = `${gi}-${ii}`;
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
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </Modal>
  );
}
