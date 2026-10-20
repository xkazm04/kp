// State + data-loading for the Kit tab of the job posting modal (JobsKitTab.tsx), split
// out like jobsAgentFitLogic.ts so the view files stay small. Owns: the kit read, the
// backgrounded generator (POST → taskId → useTaskResult, the agent-fit pattern), the
// editor draft and which stored version it was opened from, save (PUT → a NEW draft
// version), publish, and the rehearsal ("Try this version").
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { useTaskResult, useTasks } from "@/app/features/shell/tasks/TasksProvider";
import type { KitAdjustment } from "@/app/_lib/interview-kit-validate";
import type { StoredInterviewKit } from "@/app/_lib/interview-kit-types";
import {
  blankDraft,
  draftFromKit,
  draftToKit,
  kitDraftProblems,
  kitRejection,
  knownAdjustments,
  openVersion,
  rehearsalTarget,
  type KitDraft,
  type KitState,
} from "./jobsKitModel";

const JSON_HEADERS = { "Content-Type": "application/json" };

export function useJobKitLogic(jobId: string) {
  const t = useTranslations("jobs.kit");
  // Every door here answers `{ error, code }`; the code is resolved through the
  // `errors` catalog, never the English `error` (app/_lib/use-error-message.ts).
  const errMsg = useErrorMessage();
  const url = `/api/jobs/${encodeURIComponent(jobId)}/interview-kit`;
  const { data, error: loadError, reload } = useJsonFetch<KitState>(url, t("loadFailed"));
  const loading = data === null && loadError === null;
  const base = openVersion(data);

  // ---- the generator (task kind interview_kit) ---------------------------------------
  const { refresh: refreshTasks } = useTasks();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const task = useTaskResult(taskId);
  // Which engine wrote the last draft this session generated. The stored row says only
  // generated-vs-edited, so this is the one moment the product KNOWS a keyless install
  // produced a template — and says so (the task drawer shows the same fact).
  const [engine, setEngine] = useState<"llm" | "deterministic" | null>(null);
  // Completion is consumed DURING render, once per task (the guarded render-phase
  // pattern useScheduleInterviewPrep uses) rather than in an effect round-trip.
  const [handledTask, setHandledTask] = useState<string | null>(null);
  if (taskId && handledTask !== taskId) {
    const succeeded = task.status === "succeeded" && (task.full !== null || task.resultUnavailable);
    const stopped = task.status === "failed" || task.status === "canceled" || task.status === "interrupted";
    if (succeeded || stopped) {
      setHandledTask(taskId);
      if (succeeded) {
        const source = (task.full?.result as { source?: unknown } | null | undefined)?.source;
        setEngine(source === "llm" ? "llm" : source === "deterministic" ? "deterministic" : null);
        // The draft is the durable result (an interview_kits row); the GET is the truth.
        reload();
      }
    }
  }
  // Running from the click until the task reaches a terminal state — the just-started
  // window (status still null) must not flash the CTA back.
  const generating = taskId !== null && handledTask !== taskId;

  const generate = async () => {
    if (generating) return;
    setStartError(null);
    setEngine(null);
    try {
      const r = await fetch(url, { method: "POST" });
      const p = (await r.json().catch(() => null)) as { taskId?: string; error?: string; code?: string } | null;
      if (!r.ok || !p?.taskId) throw new Error(errMsg(p, t("generateFailed")));
      setTaskId(p.taskId);
      void refreshTasks();
    } catch (e) {
      setStartError(e instanceof Error && e.message ? e.message : t("generateFailed"));
    }
  };

  // ---- the editor draft -------------------------------------------------------------
  // The draft remembers which stored version it was opened from ("blank" for a kit
  // written from scratch). A newer version arriving (a finished generation, another
  // tab's save) re-seeds the editor only when the author has nothing unsaved; otherwise
  // it waits behind an explicit "discard and open" rather than eating their work.
  const [draft, setDraft] = useState<KitDraft | null>(null);
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const [baseAtOpen, setBaseAtOpen] = useState<StoredInterviewKit | null>(null);
  // The wire shape the draft had when it was opened: "dirty" is any difference from it,
  // which works the same for a stored version and for a kit started from scratch.
  const [openedAs, setOpenedAs] = useState<string | null>(null);
  const wire = (d: KitDraft) => JSON.stringify(draftToKit(d));
  const dirty = draft !== null && wire(draft) !== openedAs;
  const openDraft = (from: StoredInterviewKit | null, next: KitDraft) => {
    setDraftFor(from ? from.id : "blank");
    setBaseAtOpen(from);
    setDraft(next);
    setOpenedAs(wire(next));
  };
  // NEWER, not merely different: right after a save the editor already holds version
  // N+1 while the list still answers N, and "different" would re-open N over it.
  const baseIsNewer = base !== null && (draftFor === null || base.version > (baseAtOpen?.version ?? 0));
  if (base && baseIsNewer && (draft === null || !dirty)) {
    openDraft(base, draftFromKit(base.kit));
  }
  const newerArrived = baseIsNewer && dirty ? base : null;
  const openLatest = () => {
    if (!base) return;
    openDraft(base, draftFromKit(base.kit));
    setAdjusted(null);
  };
  const startBlank = () => {
    openDraft(null, blankDraft());
    setAdjusted(null);
  };
  const check = draft ? kitDraftProblems(draft) : null;

  // ---- save → a new draft version --------------------------------------------------
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [adjusted, setAdjusted] = useState<KitAdjustment[] | null>(null);
  const [rejection, setRejection] = useState<ReturnType<typeof kitRejection>>(null);
  const save = async () => {
    if (!draft || saving || (check && check.blocking.length > 0)) return;
    setSaving(true);
    setSaveError(null);
    setRejection(null);
    try {
      const r = await fetch(url, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ kit: draftToKit(draft) }) });
      const p = (await r.json().catch(() => null)) as { kit?: StoredInterviewKit; adjusted?: unknown; code?: string } | null;
      if (!r.ok || !p?.kit) {
        setRejection(kitRejection(p));
        throw new Error(errMsg(p, t("saveFailed")));
      }
      // The saved version IS the new base: re-open the editor on what the server stored
      // (trimmed, ids kept) so the next dirty check compares against the truth.
      openDraft(p.kit, draftFromKit(p.kit.kit));
      setAdjusted(knownAdjustments(p.adjusted));
      reload();
    } catch (e) {
      setSaveError(e instanceof Error && e.message ? e.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  // ---- publish ------------------------------------------------------------------------
  const [publishing, setPublishing] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const publish = async (kitId: string) => {
    if (publishing) return;
    setPublishing(kitId);
    setPublishError(null);
    try {
      const r = await fetch(`${url}/publish`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ kitId }) });
      const p = (await r.json().catch(() => null)) as { code?: string } | null;
      if (!r.ok) throw new Error(errMsg(p, t("publishFailed")));
      reload();
    } catch (e) {
      setPublishError(e instanceof Error && e.message ? e.message : t("publishFailed"));
      // "Already published" and "not found" are one refusal on purpose; the version
      // list is what tells the recruiter which it was.
      reload();
    } finally {
      setPublishing(null);
    }
  };

  // ---- rehearse ("Try this version") ------------------------------------------------
  const [rehearsing, setRehearsing] = useState(false);
  const [rehearseError, setRehearseError] = useState<string | null>(null);
  /** Set only when the browser refused to open the tab: the link to click instead. */
  const [rehearseLink, setRehearseLink] = useState<string | null>(null);
  const rehearse = async (kitId: string) => {
    if (rehearsing) return;
    setRehearsing(true);
    setRehearseError(null);
    setRehearseLink(null);
    // Opened synchronously, INSIDE the click, so a popup blocker sees a user gesture;
    // it is pointed at the rehearsal once the door answers and closed if it refuses.
    // (Opening after the await would be blocked, and `noopener` would make the handle
    // null, so the opener is cut by hand once the tab is ours.)
    const tab = typeof window === "undefined" ? null : window.open("", "_blank");
    try {
      const r = await fetch(`${url}/rehearse`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ kitId }) });
      const p = (await r.json().catch(() => null)) as { url?: unknown; code?: string } | null;
      const target = r.ok ? rehearsalTarget(p) : null;
      if (!target) {
        tab?.close();
        setRehearseError(errMsg(r.ok ? null : p, t("rehearseFailed")));
        return;
      }
      if (tab) {
        tab.opener = null;
        tab.location.href = target;
      } else {
        setRehearseLink(target);
      }
    } catch {
      tab?.close();
      setRehearseError(t("rehearseFailed"));
    } finally {
      setRehearsing(false);
    }
  };

  return {
    t,
    state: data,
    loading,
    loadError,
    reload,
    base,
    baseAtOpen,
    generate,
    generating,
    progressMsg: task.progressMsg,
    startError,
    // The task runner's own diagnostic is English prose with no code to resolve, so the
    // tab states the outcome in the reader's language instead of forwarding it.
    taskFailed: taskId !== null && (task.status === "failed" || task.status === "interrupted"),
    engine,
    draft,
    setDraft,
    dirty,
    check,
    newerArrived,
    openLatest,
    startBlank,
    save,
    saving,
    saveError,
    adjusted,
    rejection,
    publish,
    publishing,
    publishError,
    rehearse,
    rehearsing,
    rehearseError,
    rehearseLink,
  };
}

export type JobKitLogic = ReturnType<typeof useJobKitLogic>;
