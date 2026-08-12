"use client";

// AI-assisted draft panel split out of ProfileEditor.tsx: owns its own open/text/error/
// note state and the draft run; hands the hydrated draft back to the parent editor via
// onApplied so the parent's form state stays the single source of truth.
//
// Drafting runs as the background task kind "profile_draft" (wait-or-leave): the run
// survives navigation, and when the recruiter stays the finished draft applies live via
// useTaskResult. If they leave, the draft remains readable on the task's result in the
// Background-tasks view — flagged by the unread badge.
import { useEffect, useState } from "react";
import { Sparkles, Wand2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ProfilePayload } from "@/app/features/shared/profileTypes";
import { Textarea } from "./ProfileFields";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { useTasks } from "@/app/features/shell/tasks/TasksProvider";
import { useTaskResult } from "@/app/features/shell/tasks/useTaskResult";
import { TaskFlightNote } from "@/app/features/shell/tasks/TaskFlightNote";

export type ProfileDraft = {
  profile: ProfilePayload;
  signals?: { isEnrolled?: boolean; expectedGraduation?: string | null; wantsDomainChange?: boolean; hasSubstantialExperience?: boolean };
  archetype?: string;
};

export function ProfileEditorAiDraft({ onApplied }: { onApplied: (draft: ProfileDraft) => void }) {
  const t = useTranslations("profile.editor");
  const enumLabel = useEnumLabel();
  const { startTask } = useTasks();

  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const watch = useTaskResult(taskId);
  const aiLoading = watch.active || watch.loading;

  const runDraft = async () => {
    if (!aiText.trim() || aiLoading) return;
    setAiError(null);
    setAiNote(null);
    const task = await startTask("profile_draft", { text: aiText });
    if (task) setTaskId(task.id);
  };

  // React to the flight's outcome: apply the draft into the editor on success,
  // surface the task's error otherwise. Runs only while a task is being watched.
  useEffect(() => {
    if (!taskId) return;
    const full = watch.status === "succeeded" ? watch.full : null;
    const dead = watch.status === "failed" || watch.status === "interrupted" || watch.status === "canceled";
    if (!full && !dead) return;
    // Deferred (0 ms timer) kick-off — no synchronous setState in the effect
    // body (react-hooks/set-state-in-effect), the repo's established pattern.
    const timer = window.setTimeout(() => {
      setTaskId(null);
      if (full) {
        const payload = full.result as (ProfileDraft & { confidence?: number }) | null;
        if (!payload || typeof payload !== "object" || !payload.profile) {
          setAiError(t("aiDraftFailed"));
          return;
        }
        onApplied(payload);
        const label = enumLabel("archetype", payload.archetype);
        setAiNote(t("draftedAs", { label, pct: Math.round((payload.confidence ?? 0) * 100) }));
      } else {
        // The task runner's own stored diagnostic, passed through unchanged (no
        // machine code to resolve) — ternary, not ||, per use-error-message.ts.
        setAiError(watch.error ? watch.error : t("aiDraftFailed"));
      }
    }, 0);
    return () => window.clearTimeout(timer);
    // onApplied/enumLabel are stable enough per render for this outcome hook; the
    // guard on taskId + terminal status makes re-entry impossible.
  }, [taskId, watch.status, watch.full, watch.error, onApplied, enumLabel, t]);

  return (
    <div className="mt-4 rounded-lg border border-coral/30 bg-coral/5 p-3">
      <button
        type="button"
        onClick={() => setAiOpen((v) => !v)}
        aria-expanded={aiOpen}
        className="focus-ring flex w-full items-center gap-2 rounded text-left text-sm font-semibold text-ink"
      >
        <Sparkles size={15} className="text-coral" aria-hidden />
        {t("draftToggle")}
        <span className="ml-1 font-normal text-steel">{t("draftHint")}</span>
        <span className="ml-auto text-steel">{aiOpen ? "−" : "+"}</span>
      </button>
      {aiOpen ? (
        <div className="mt-2.5">
          <Textarea
            value={aiText}
            onChange={(e) => setAiText(e.target.value)}
            rows={4}
            placeholder={t("draftPlaceholder")}
            className="bg-white px-3 py-2 text-ink"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={runDraft}
              disabled={aiLoading || !aiText.trim()}
              className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-steel disabled:opacity-40"
            >
              <Wand2 size={14} /> {aiLoading ? t("drafting") : t("draftWithAi")}
            </button>
            <span className="text-sm text-steel">{t("draftSavedHint")}</span>
          </div>
          <TaskFlightNote watch={watch} className="mt-2" />
          {aiNote ? <p className="mt-2 text-sm font-medium text-moss" role="status">{aiNote}</p> : null}
          {aiError ? <p className="mt-2 text-sm text-red-700" role="alert">{aiError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
