"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Clock, Copy, History, Loader2, ListChecks, NotebookPen, Plus, RefreshCw, Sparkles, UserRound, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { copyText } from "@/app/_lib/export-utils";
import { HumanScorecardPanel } from "./HumanScorecardPanel";
import type { Scorecard } from "@/app/_lib/interview-scorecard";
import type { RunOfShow } from "@/app/_lib/run-of-show";
import type { InterviewPrepProgress } from "@/app/_lib/interview-prep";
import { Modal } from "@/app/_components/Modal";
import { Meter } from "@/app/_components/Meter";
import { Checkbox } from "@/app/_components/Checkbox";
import { TextInput } from "@/app/_components/TextInput";
import { TextArea } from "@/app/_components/TextArea";
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
  // Questions imported from the candidate's analysis report (Direction 2). A
  // dedicated key preserved across Regenerate. An element is either a legacy plain
  // string OR a { question, blockRef? } entry (Direction 3): a `blockRef` names the
  // chronology block topic the question has been WOVEN into, so it renders inside
  // that block + counts in the completion meter rather than sitting read-only below.
  // ONE key, so the voice brief that reads importedQuestions composes with it.
  importedQuestions?: ImportedQuestion[];
};

// Direction 3 — an imported question, normalized to the entry shape the modal
// renders. A woven question carries the topic of the block it belongs to.
type ImportedEntry = { question: string; blockRef?: string };
type ImportedQuestion = string | ImportedEntry;

/** Normalize a stored importedQuestions element (legacy string or {question,
 *  blockRef?}) to an entry, tolerating junk. Mirrors the server's
 *  normalizeImportedEntry so the modal and the API agree on the one shape. */
function normImported(raw: ImportedQuestion): ImportedEntry | null {
  if (typeof raw === "string") {
    const q = raw.trim();
    return q ? { question: q } : null;
  }
  if (raw && typeof raw === "object") {
    const q = typeof raw.question === "string" ? raw.question.trim() : "";
    if (!q) return null;
    const blockRef = typeof raw.blockRef === "string" && raw.blockRef.trim() ? raw.blockRef.trim() : undefined;
    return blockRef ? { question: q, blockRef } : { question: q };
  }
  return null;
}

export function InterviewPrepModal({ entry, onClose }: { entry: SchedEntry; onClose: () => void }) {
  const t = useTranslations("scheduleTab.prep");
  const locale = useLocale(); // PREP2 — generate the prep pack in the recruiter's language
  const { startTask } = useTasks();
  // Load any saved artifact via the shared hook (handles non-OK status, an {error}
  // body, and unmount). A load FAILURE now surfaces as a distinct error+retry state
  // (idea-bc78b8f5), never collapsed into the "none yet" empty state.
  const { data, error, reload } = useJsonFetch<{ prep?: { payload?: Prep; createdAt?: string }; jdEditedAt?: string | null }>(
    `/api/interview-prep?entry=${encodeURIComponent(entry.id)}`,
    t("loadFailed")
  );
  const [generated, setGenerated] = useState<Prep | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState("");
  const [interviewer, setInterviewer] = useState(""); // assigned human owner (PREP5)
  const [copied, setCopied] = useState(false);
  // Direction 3 — the imported questions the modal shows. Seeded from the payload,
  // overridden locally after a weave/unweave PATCH (so the block/imported split
  // updates without a full refetch); reset to null on a completed (re)generation,
  // which carries importedQuestions forward. `pickerFor` is the question whose
  // "add to plan" block-picker is currently open (single-open).
  const [importedOverride, setImportedOverride] = useState<ImportedEntry[] | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
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
  // Direction 1 — the pack is STALE when the linked JD was edited after this prep was
  // generated. String compare on ISO-8601 UTC, exactly like the analyses roster. Gated
  // on `!generated`: a just-regenerated pack is current (its fresh createdAt isn't in
  // client state, so trust the regeneration over the now-stale GET). Surfaced, never
  // auto-acted — the interviewer chooses whether to regenerate.
  const jdEditedAt = data?.jdEditedAt ?? null;
  const savedCreatedAt = data?.prep?.createdAt ?? null;
  const stale = !generated && !!prep && jdEditedAt != null && savedCreatedAt != null && savedCreatedAt < jdEditedAt;
  const jdEditedLabel = jdEditedAt
    ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(new Date(jdEditedAt))
    : "";

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
    // The regenerated result carries importedQuestions forward, so drop any local
    // weave override and read the fresh copy (blockRefs preserved by the merge).
    setImportedOverride(null);
    setPickerFor(null);
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

  // Direction 3 — the imported questions, normalized and split into WOVEN (assigned
  // to a chronology block by its topic) and UNASSIGNED. A blockRef that no longer
  // matches any current block topic (e.g. a Regenerate reshaped the plan) degrades to
  // unassigned so the question is shown again rather than silently lost — its content
  // is always preserved in importedQuestions.
  const importedEntries = useMemo<ImportedEntry[]>(() => {
    if (importedOverride) return importedOverride;
    const raw = prep?.importedQuestions ?? [];
    return raw.map(normImported).filter((e): e is ImportedEntry => e !== null);
  }, [importedOverride, prep]);
  const blockTopics = useMemo(() => new Set((prep?.chronology ?? []).map((b) => b.topic)), [prep]);
  const wovenList = useMemo(
    () => importedEntries.filter((e) => e.blockRef && blockTopics.has(e.blockRef)),
    [importedEntries, blockTopics]
  );
  const unassigned = useMemo(
    () => importedEntries.filter((e) => !e.blockRef || !blockTopics.has(e.blockRef)),
    [importedEntries, blockTopics]
  );
  const wovenForBlock = (topic: string) => wovenList.filter((e) => e.blockRef === topic);
  // Short, stable-enough checkbox key for a woven question (index in wovenList —
  // like the c-/k- keys; the PUT route caps checked keys at 64 chars, so the raw
  // question text can't be the key).
  const wovenKeyOf = (question: string) => `w-${wovenList.findIndex((e) => e.question === question)}`;

  // Weave an imported question into a block (blockRef = topic) or unassign it
  // (blockRef = null), via the PATCH that only moves the blockRef — the question
  // stays in its single home (importedQuestions). Optimistically applies the
  // server's returned list so the block/imported split updates without a refetch.
  const setBlock = async (question: string, blockRef: string | null) => {
    setPickerFor(null);
    try {
      const res = await fetch(`/api/interview-prep?entry=${encodeURIComponent(entry.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, blockRef }),
      });
      const d = (await res.json().catch(() => ({}))) as { importedQuestions?: ImportedQuestion[] };
      if (res.ok && Array.isArray(d.importedQuestions)) {
        setImportedOverride(d.importedQuestions.map(normImported).filter((e): e is ImportedEntry => e !== null));
      }
    } catch {
      /* weave is best-effort — a blip shouldn't interrupt the interview */
    }
  };

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
      // Woven imported questions live inside their block (Direction 3).
      for (const w of wovenForBlock(b.topic)) lines.push(`    "${w.question}"`);
      if (b.followUp) lines.push(`    ${t("copyFollowUp", { text: b.followUp })}`);
    }
    const sig = prep.signals ?? [];
    if (sig.length) {
      lines.push("", t("copySignals"));
      for (const s of sig) lines.push(`- ${s}`);
    }
    // Only UNASSIGNED imported questions remain in the reference section.
    if (unassigned.length) {
      lines.push("", t("importedQuestions"));
      for (const q of unassigned) lines.push(`- "${q.question}"`);
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
  // Woven imported questions are checkable items too (Direction 3), so they count in
  // the total alongside the chronology blocks and the signals.
  const totalItems = useMemo(
    () => (prep ? prep.chronology.length + (prep.signals ?? []).length + wovenList.length : 0),
    [prep, wovenList]
  );
  // Count only keys that map to a CURRENTLY-rendered item (c-<i> for chronology, k-<i> for
  // signals, w-<i> for woven imported questions). Counting every truthy key in the stored map
  // let a payload whose generated body shrank — but kept older userProgress keys — render
  // "9/6 done" (> total) and a >100% meter.
  const doneItems = useMemo(() => {
    if (!prep) return 0;
    let n = 0;
    for (let i = 0; i < prep.chronology.length; i++) if (checked[`c-${i}`]) n += 1;
    for (let i = 0; i < (prep.signals ?? []).length; i++) if (checked[`k-${i}`]) n += 1;
    for (let i = 0; i < wovenList.length; i++) if (checked[`w-${i}`]) n += 1;
    return n;
  }, [prep, checked, wovenList]);

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
            {stale ? (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-800">
                <History size={15} className="mt-0.5 shrink-0" />
                <span>
                  {t("jdEditedSince", { date: jdEditedLabel })}{" "}
                  <button
                    type="button"
                    onClick={generate}
                    disabled={generating}
                    className="font-semibold underline underline-offset-2 hover:text-amber-900 disabled:opacity-50"
                  >
                    {generating ? t("regenerating") : t("regenerate")}
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
                const woven = wovenForBlock(b.topic);
                return (
                  <li key={key} className={`rounded-md border p-2.5 transition-colors ${on ? "border-moss/40 bg-moss/5" : "border-stone-200"}`}>
                    <label className="flex cursor-pointer items-start gap-2.5">
                      <Checkbox
                        checked={on}
                        onChange={(e) => {
                          markEdited();
                          setChecked((s) => ({ ...s, [key]: e.target.checked }));
                        }}
                        className="mt-0.5"
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
                    {/* Woven imported questions (Direction 3): checkable, counted in
                        the meter, each removable back to the imported section. */}
                    {woven.length ? (
                      <ul className="mt-1.5 space-y-1 border-t border-stone-200 pt-1.5">
                        {woven.map((w) => {
                          const wkey = wovenKeyOf(w.question);
                          const won = Boolean(checked[wkey]);
                          return (
                            <li key={wkey} className="flex items-start gap-1.5">
                              <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-sm text-ink">
                                <Checkbox
                                  checked={won}
                                  onChange={(e) => {
                                    markEdited();
                                    setChecked((s) => ({ ...s, [wkey]: e.target.checked }));
                                  }}
                                  className="mt-0.5"
                                />
                                <span className={`min-w-0 ${won ? "text-steel line-through" : ""}`}>
                                  “{w.question}”
                                  <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-paper px-1 py-0.5 align-middle text-meta font-semibold text-steel">
                                    <Sparkles size={10} aria-hidden /> {t("importedTag")}
                                  </span>
                                </span>
                              </label>
                              <button
                                type="button"
                                onClick={() => setBlock(w.question, null)}
                                aria-label={t("removeFromPlanAria")}
                                title={t("removeFromPlan")}
                                className="focus-ring mt-0.5 shrink-0 rounded p-0.5 text-steel hover:text-coral"
                              >
                                <X size={13} aria-hidden />
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
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
                        <Checkbox
                          checked={Boolean(checked[key])}
                          onChange={(e) => {
                            markEdited();
                            setChecked((s) => ({ ...s, [key]: e.target.checked }));
                          }}
                          className="mt-0.5"
                        />
                        <span className={checked[key] ? "text-steel line-through" : ""}>{it}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {/* Questions imported from the candidate's analysis report (Direction 2):
              reference material the interviewer can WEAVE into a timed block (Direction
              3). Once woven, a question moves up into its block above; only the
              still-unassigned ones remain here. */}
          {unassigned.length ? (
            <section>
              <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
                <Sparkles size={13} /> {t("importedQuestions")}
              </p>
              <ul className="mt-1.5 space-y-1.5">
                {unassigned.map((q, i) => {
                  const picking = pickerFor === q.question;
                  return (
                    <li key={`iq-${i}`} className="rounded-md border border-stone-200 p-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 flex-1 text-sm text-ink">“{q.question}”</span>
                        <button
                          type="button"
                          onClick={() => setPickerFor(picking ? null : q.question)}
                          aria-expanded={picking}
                          className="focus-ring inline-flex shrink-0 items-center gap-1 rounded-md border border-stone-200 px-2 py-1 text-meta font-semibold text-ink hover:border-coral/40"
                        >
                          <Plus size={12} className="text-coral" /> {t("addToPlan")}
                        </button>
                      </div>
                      {/* Block picker: choose which timed block to weave this into.
                          The plan's own topics, so the choice is always valid. */}
                      {picking ? (
                        <div className="mt-2 flex flex-wrap gap-1.5 border-t border-stone-200 pt-2">
                          {prep.chronology.length ? (
                            prep.chronology.map((b, bi) => (
                              <button
                                key={`pick-${bi}`}
                                type="button"
                                onClick={() => setBlock(q.question, b.topic)}
                                className="focus-ring rounded-full border border-stone-200 px-2.5 py-1 text-meta font-semibold text-steel hover:border-coral/40 hover:text-ink"
                              >
                                {b.topic}
                              </button>
                            ))
                          ) : (
                            <span className="text-meta text-steel">{t("noBlocksToWeave")}</span>
                          )}
                        </div>
                      ) : null}
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
            <TextInput
              id="prep-interviewer"
              type="text"
              value={interviewer}
              onChange={(e) => {
                markEdited();
                setInterviewer(e.target.value);
              }}
              placeholder={t("interviewerPlaceholder")}
              sizeVariant="sm"
              className="mt-1.5"
            />
          </section>

          {/* Interviewer notes (PREP2): a durable scratchpad for verbatim quotes /
              evidence, autosaved with the checklist and restored on reopen. */}
          <section>
            <label htmlFor="prep-notes" className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
              <NotebookPen size={13} /> {t("interviewerNotes")}
            </label>
            <TextArea
              id="prep-notes"
              value={notes}
              onChange={(e) => {
                markEdited();
                setNotes(e.target.value);
              }}
              rows={3}
              placeholder={t("notesPlaceholder")}
              sizeVariant="sm"
              className="mt-1.5"
            />
          </section>

          {/* Human scorecard (PREP1): fill the role's rubric live and save it
              against this candidate — the human counterpart to the AI voice-screen
              scorecard. Hydrated from the freshest payload: a regenerated result
              carries the saved scorecard forward, so never read the stale GET. */}
          <HumanScorecardPanel entryId={entry.id} archetype={entry.archetype} roleFamily={entry.roleFamily} initial={prep.humanScorecard} />
        </div>
      )}
    </Modal>
  );
}
