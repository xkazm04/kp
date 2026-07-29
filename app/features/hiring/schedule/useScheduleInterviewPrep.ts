"use client";

// All state + fetch/save/generate logic for the interview-prep modal, split out
// of ScheduleInterviewPrepModal.tsx so the component file stays under the
// 200-line cap. Returns everything the modal's render needs; no JSX here.

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { copyText } from "@/app/_lib/export-utils";
import type { InterviewPrepProgress } from "@/app/_lib/interview-prep";
import { isPrepFallback } from "@/app/_components/Badge";
import { useTasks, useTaskResult } from "@/app/features/shell/tasks/TasksProvider";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import type { SchedEntry } from "./ScheduleTypes";
import { normImported, type ImportedEntry, type ImportedQuestion, type Prep } from "./scheduleInterviewPrepTypes";

export function useScheduleInterviewPrep(entry: SchedEntry) {
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

  return {
    t,
    prep,
    loading,
    error,
    reload,
    generate,
    generating,
    fallback,
    stale,
    jdEditedLabel,
    copied,
    copyPrep,
    checked,
    setChecked,
    markEdited,
    notes,
    setNotes,
    interviewer,
    setInterviewer,
    signals,
    wovenForBlock,
    wovenKeyOf,
    unassigned,
    pickerFor,
    setPickerFor,
    setBlock,
    totalItems,
    doneItems,
  };
}
