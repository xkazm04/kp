"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Clock, Copy, Loader2, ListChecks, NotebookPen, RefreshCw, Sparkles, UserRound } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { copyText } from "@/app/_lib/export-utils";
import { HumanScorecardPanel } from "./HumanScorecardPanel";
import type { Scorecard } from "@/app/_lib/interview-scorecard";
import type { RunOfShow } from "@/app/_lib/run-of-show";
import type { InterviewPrepProgress } from "@/app/_lib/interview-prep";
import { Modal } from "@/app/_components/Modal";
import { Meter } from "@/app/_components/Meter";
import { PrepSourceBadge, isPrepFallback } from "@/app/_components/Badge";
import { useTasks, useTaskResult } from "@/app/features/tasks/TasksProvider";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import type { SchedEntry } from "./ScheduleTypes";

// The persisted prep artifact payload: the generated run-of-show (single-sourced
// from RunOfShow — scenario/durationMin/focusAreas/chronology/signals) plus the
// human-input seams. `userProgress` (PREP2) rides inside the payload as the
// interviewer's ticked items + notes; it is exactly InterviewPrepProgress minus
// the top-level `interviewer` (which saveInterviewPrepProgress splits out), so it
// is single-sourced from the server type rather than re-declared and left to drift.
type Prep = RunOfShow & {
  source?: string;
  userProgress?: Omit<InterviewPrepProgress, "interviewer">;
  humanScorecard?: Scorecard;
  interviewer?: string;
};

export function InterviewPrepModal({ entry, onClose }: { entry: SchedEntry; onClose: () => void }) {
  const t = useTranslations("scheduleTab.prep");
  const locale = useLocale(); // PREP2 — generate the prep pack in the recruiter's language
  const { startTask } = useTasks();
  // Load any saved artifact via the shared hook (handles non-OK status, an {error}
  // body, and unmount). A load FAILURE now surfaces as a distinct error+retry state
  // (idea-bc78b8f5), never collapsed into the "none yet" empty state.
  const { data, error, reload } = useJsonFetch<{ prep?: { payload?: Prep } }>(
    `/api/interview-prep?entry=${encodeURIComponent(entry.id)}`,
    t("loadFailed")
  );
  const [generated, setGenerated] = useState<Prep | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState("");
  const [interviewer, setInterviewer] = useState(""); // assigned human owner (PREP5)
  const [copied, setCopied] = useState(false);
  // PREP2: hydrate the interviewer's saved checklist + notes once the artifact
  // loads, then debounce-persist edits. The `hydrated` flag stops the saved state from
  // being written straight back; `dirtyRef` gates the save to genuine user edits.
  const [hydrated, setHydrated] = useState(false);
  const dirtyRef = useRef(false);
  const markEdited = () => {
    dirtyRef.current = true;
  };

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

  // Restore the interviewer's saved progress once, from the loaded artifact (a completed
  // generation seeds its own carried-forward copy in the task-completion block below).
  // Derived DURING render — the React-recommended "adjust
  // state when an input changes" pattern (You Might Not Need an Effect) — rather than in an
  // effect, so it doesn't trip react-hooks/set-state-in-effect. The `hydrated` flag makes it
  // run exactly once the GET resolves; React applies these sets before the browser paints.
  if (!hydrated && !generated && data) {
    setHydrated(true);
    const payload = data?.prep?.payload as Prep | undefined;
    const up = payload?.userProgress;
    if (up?.checked) setChecked(up.checked);
    if (up && typeof up.notes === "string") setNotes(up.notes);
    if (typeof payload?.interviewer === "string") setInterviewer(payload.interviewer);
  }

  // The single progress-PUT both the debounced save and the unmount flush issue.
  // keepalive is opt-in (only the unmount flush needs the request to survive the
  // navigation); the .catch keeps it best-effort — a blip shouldn't interrupt the
  // interview.
  const putProgress = (p: InterviewPrepProgress, keepalive = false) =>
    void fetch(`/api/interview-prep?entry=${encodeURIComponent(entry.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
      keepalive,
    }).catch(() => {
      /* progress save is best-effort */
    });

  // Debounce-persist checklist + notes edits to the artifact. Only fires after a
  // genuine user edit (dirtyRef), so hydration doesn't echo back, and only when a
  // prep exists to attach to.
  useEffect(() => {
    if (!dirtyRef.current || !prep) return;
    const h = window.setTimeout(() => {
      putProgress({ checked, notes, interviewer });
    }, 600);
    return () => window.clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked, notes, interviewer, prep, entry.id]);

  // Keep the freshest editable values in a ref so the unmount flush sends them.
  const latestProgressRef = useRef({ checked, notes, interviewer });
  useEffect(() => {
    latestProgressRef.current = { checked, notes, interviewer };
  }, [checked, notes, interviewer]);

  // Flush a pending edit on unmount (modal close). The debounce effect's cleanup
  // cancels an in-flight 600ms timer, so closing the modal within that window — very
  // common right after typing a final note at end of call — would otherwise drop the
  // last edit. keepalive lets the request survive the unmount/navigation.
  useEffect(() => {
    return () => {
      if (!dirtyRef.current || !prep) return;
      putProgress(latestProgressRef.current, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prep, entry.id]);

  // Watch a generation task; its result (fetched on demand — the poll omits it)
  // supersedes any saved artifact. Hold taskId until the full result lands so the
  // "Generating…" state persists through the brief fetch, then clear it.
  // Completion is consumed DURING render (guarded: the task id is cleared in the
  // same pass, so this runs once per task) — the guarded render-phase pattern
  // instead of an effect round-trip.
  const { status: genStatus, full: genFull } = useTaskResult(taskId);
  if (taskId && genStatus === "succeeded" && genFull) {
    const result = (genFull.result as Prep) ?? null;
    setGenerated(result);
    setTaskId(null);
    // The task carries userProgress/interviewer forward across a regeneration
    // (interview-prep-run.ts), so seed the editable state from the result — it IS
    // the server's current copy. Leaving the cleared/old state here would let the
    // next debounce PUT overwrite the carried-forward progress wholesale. dirtyRef
    // stays false: this is hydration, not a user edit, and must not echo back.
    const up = result?.userProgress;
    setChecked(up?.checked ?? {});
    setNotes(typeof up?.notes === "string" ? up.notes : "");
    setInterviewer(typeof result?.interviewer === "string" ? result.interviewer : "");
    // eslint-disable-next-line react-hooks/refs -- guarded once-per-task hydration; the dirty flag must clear atomically with the state seed above (this is the render-phase completion pattern documented above, not an effect round-trip)
    dirtyRef.current = false;
  } else if (taskId && (genStatus === "failed" || genStatus === "canceled" || genStatus === "interrupted")) {
    setTaskId(null);
  }

  const generate = async () => {
    // A regeneration replaces the plan but PRESERVES the interviewer's working
    // state: the task carries userProgress/interviewer/humanScorecard forward onto
    // the rebuilt artifact (interview-prep-run.ts), and the completion block above
    // re-seeds from the result. dirtyRef=false suppresses an echo-save of the
    // untouched state; `hydrated` stays true so a late-resolving (now-stale) GET
    // can't write over it mid-generation.
    dirtyRef.current = false;
    setHydrated(true);
    const started = await startTask("interview_prep", { entryId: entry.id, candidateLabel: entry.candidateLabel, jobTitle: entry.jobTitle, lang: locale });
    if (started) setTaskId(started.id);
  };
  const generating = taskId !== null;

  // Copy the whole prep guide as plain text (Theme C, PREP3) so an interviewer can
  // drop it into their notes / a calendar invite / an email — the guide was
  // render-only, lost the moment the modal closed.
  const copyPrep = async () => {
    if (!prep) return;
    const lines: string[] = [
      t("copyHeading", { name: entry.candidateLabel, job: entry.jobTitle ? ` · ${entry.jobTitle}` : "" }),
      "",
      prep.scenario,
    ];
    if (prep.focusAreas?.length) lines.push("", t("copyFocusAreas", { areas: prep.focusAreas.join(", ") }));
    lines.push("", t("copyRunOfShow", { min: prep.durationMin }));
    for (const b of prep.chronology) {
      lines.push(`- [${b.fromMin}–${b.toMin} min] ${b.topic} — ${b.goal}`);
      for (const q of b.questions) lines.push(`    "${q}"`);
      if (b.followUp) lines.push(`    ${t("copyFollowUp", { text: b.followUp })}`);
    }
    const sig = prep.signals ?? [];
    if (sig.length) {
      lines.push("", t("copySignals"));
      for (const s of sig) lines.push(`- ${s}`);
    }
    const ok = await copyText(lines.join("\n"));
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 2000);
  };

  // The chronology blocks plus the flat "Signals to confirm" list are the checkable
  // items; `?? []` only guards a malformed payload, not a second group shape.
  // Derived from `prep` alone (no intermediate `?? []` value in the deps, which
  // would re-make a fresh array — and re-fire the memo — every render).
  const signals = prep?.signals ?? [];
  const totalItems = useMemo(
    () => (prep ? prep.chronology.length + (prep.signals ?? []).length : 0),
    [prep]
  );
  // Count only keys that map to a CURRENTLY-rendered item (c-<i> for chronology, k-<i> for
  // signals). Counting every truthy key in the stored map let a payload whose generated body
  // shrank — but kept older userProgress keys — render "9/6 done" (> total) and a >100% meter.
  const doneItems = useMemo(() => {
    if (!prep) return 0;
    let n = 0;
    for (let i = 0; i < prep.chronology.length; i++) if (checked[`c-${i}`]) n += 1;
    for (let i = 0; i < (prep.signals ?? []).length; i++) if (checked[`k-${i}`]) n += 1;
    return n;
  }, [prep, checked]);

  return (
    <Modal
      title={t("title", { name: entry.candidateLabel })}
      subtitle={entry.jobTitle ?? undefined}
      onClose={onClose}
      size="3xl"
      footer={
        prep ? (
          <>
            <button
              type="button"
              onClick={copyPrep}
              className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:border-coral/40"
            >
              {copied ? <Check size={14} className="text-moss" /> : <Copy size={14} />}
              {copied ? t("copied") : t("copyPrep")}
            </button>
            <button
              type="button"
              onClick={generate}
              disabled={generating}
              className="focus-ring inline-flex h-9 items-center gap-1 rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:border-coral/40 disabled:opacity-50"
            >
              <RefreshCw size={14} /> {generating ? t("generating") : t("regenerate")}
            </button>
          </>
        ) : null
      }
    >
      {loading ? (
        <p className="text-sm text-steel">{t("loading")}</p>
      ) : generating && !prep ? (
        <p className="flex items-center gap-2 text-sm text-steel">
          <Loader2 size={16} className="animate-spin text-coral" /> {t("generatingPlan")}
        </p>
      ) : error && !prep ? (
        // Distinct failure state: a 500 / DB lock / parse error must never read as
        // "no prep yet". Offer a retry (re-fetch) and a generate-fresh path.
        <div className="text-center">
          <p className="flex items-center justify-center gap-2 text-sm text-coral">
            <AlertTriangle size={15} /> {error}
          </p>
          <p className="mt-1 text-meta text-steel">{t("loadErrorHint")}</p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={reload}
              className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:border-coral/40"
            >
              <RefreshCw size={14} /> {t("retry")}
            </button>
            <button
              type="button"
              onClick={generate}
              disabled={generating}
              className="focus-ring inline-flex h-9 items-center gap-2 rounded-md bg-coral px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              <Sparkles size={16} /> {t("generate")}
            </button>
          </div>
        </div>
      ) : !prep ? (
        <div className="text-center">
          <p className="text-sm text-steel">{t("noPrep")}</p>
          <button
            type="button"
            onClick={generate}
            className="focus-ring mt-3 inline-flex h-10 items-center gap-2 rounded-md bg-coral px-4 text-sm font-semibold text-white hover:opacity-90"
          >
            <Sparkles size={16} /> {t("generatePrep")}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              {/* Provenance: AI-tailored vs deterministic template fallback. */}
              <PrepSourceBadge source={prep.source} />
              <span className="nums shrink-0 rounded-md bg-paper px-2 py-1 text-sm font-semibold text-coral">{t("doneCount", { done: doneItems, total: totalItems })}</span>
            </div>
            {fallback ? (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-800">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                <span>
                  {t("fallbackNote")}{" "}
                  <button
                    type="button"
                    onClick={generate}
                    disabled={generating}
                    className="font-semibold underline underline-offset-2 hover:text-amber-900 disabled:opacity-50"
                  >
                    {generating ? t("regenerating") : t("regenerateWithAi")}
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
              aria-label={t("coverageAria", { done: doneItems, total: totalItems })}
            />
          </div>

          {/* Run of show — the timed plan, checkable topic-by-topic during the interview. */}
          <section>
            <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
              <Clock size={13} /> {t("runOfShow", { min: prep.durationMin })}
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
                        onChange={(e) => {
                          markEdited();
                          setChecked((s) => ({ ...s, [key]: e.target.checked }));
                        }}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-coral"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className={`text-sm font-semibold ${on ? "text-steel line-through" : "text-ink"}`}>{b.topic}</span>
                          <span className="shrink-0 rounded bg-paper px-1.5 py-0.5 text-sm nums text-steel">{t("minRange", { from: b.fromMin, to: b.toMin })}</span>
                        </span>
                        <span className="mt-0.5 block text-sm text-steel">{b.goal}</span>
                        {b.questions.map((q, j) => (
                          <span key={j} className="mt-1 block text-sm text-ink">“{q}”</span>
                        ))}
                        {b.followUp ? <span className="mt-0.5 block text-sm text-steel">{t("followUp", { text: b.followUp })}</span> : null}
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
                <ListChecks size={13} /> {t("signalsToConfirm")}
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
                          onChange={(e) => {
                            markEdited();
                            setChecked((s) => ({ ...s, [key]: e.target.checked }));
                          }}
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

          {/* Interviewer assignment (PREP5): who owns this round. Autosaved with the
              checklist; surfaced on the schedule card so a multi-interviewer team
              sees ownership at a glance. */}
          <section>
            <label htmlFor="prep-interviewer" className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
              <UserRound size={13} /> {t("interviewer")}
            </label>
            <input
              id="prep-interviewer"
              type="text"
              value={interviewer}
              onChange={(e) => {
                markEdited();
                setInterviewer(e.target.value);
              }}
              placeholder={t("interviewerPlaceholder")}
              className="focus-ring mt-1.5 w-full rounded-md border border-stone-200 bg-white p-2 text-sm text-ink"
            />
          </section>

          {/* Interviewer notes (PREP2): a durable scratchpad for verbatim quotes /
              evidence, autosaved with the checklist and restored on reopen. */}
          <section>
            <label htmlFor="prep-notes" className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
              <NotebookPen size={13} /> {t("interviewerNotes")}
            </label>
            <textarea
              id="prep-notes"
              value={notes}
              onChange={(e) => {
                markEdited();
                setNotes(e.target.value);
              }}
              rows={3}
              placeholder={t("notesPlaceholder")}
              className="focus-ring mt-1.5 w-full rounded-md border border-stone-200 bg-white p-2 text-sm text-ink"
            />
          </section>

          {/* Human scorecard (PREP1): fill the role's rubric live and save it
              against this candidate — the human counterpart to the AI voice-screen
              scorecard. Hydrated from the freshest payload: a regenerated result
              carries the saved scorecard forward, so never read the stale GET. */}
          <HumanScorecardPanel entryId={entry.id} archetype={entry.archetype} initial={prep.humanScorecard} />
        </div>
      )}
    </Modal>
  );
}
