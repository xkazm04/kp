"use client";

// The candidate's direct edits: the manual stage move, clearing a degraded-intake
// flag, and the on-demand GitHub deep-dive. Each answers a refusal in the reader's
// language — from the machine `code`, never the server's English `error`.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { buildGithubEvidenceSummary, type GithubEvidenceSummary } from "@/app/_lib/github-summary";
import { githubAnalysisSchema } from "@/app/_lib/schemas";
import { postPipelineAction } from "@/app/_lib/useAddToPipeline";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { useGithubErrorMessage } from "@/app/_lib/use-github-error";
import type { Entry } from "../../PipelineCandidateDrawerTypes";

export function useCandidateEdits({
  entry,
  onChanged,
  onClose,
  onOpenEntry,
}: {
  entry: Entry;
  onChanged: () => void;
  onClose: () => void;
  onOpenEntry?: (entryId: string) => void;
}) {
  const t = useTranslations("pipeline.drawer");
  const errMsg = useErrorMessage();
  const ghErrMsg = useGithubErrorMessage();
  const [movingStage, setMovingStage] = useState(false);
  const [moveErr, setMoveErr] = useState<string | null>(null);
  const [resolvingIntake, setResolvingIntake] = useState(false);
  const [intakeErr, setIntakeErr] = useState<string | null>(null);
  const [ghBusy, setGhBusy] = useState(false);
  const [ghErr, setGhErr] = useState<string | null>(null);
  const [ghRun, setGhRun] = useState<GithubEvidenceSummary | null>(null);

  // A stage move CORRECTS a miscategorization. `expectedStage` makes a move decided
  // against a stale view 409 instead of clobbering a concurrent change; on success the
  // board reloads and the candidate refreshes IN PLACE (same id, same tab), so the
  // recruiter is never ejected from what they were reading.
  const moveStage = async (toStage: string) => {
    if (toStage === entry.stage || movingStage) return;
    setMovingStage(true);
    setMoveErr(null);
    try {
      const res = await postPipelineAction(entry.id, { action: "set_stage", toStage, expectedStage: entry.stage });
      if (res.status === 401 || res.status === 403) throw new Error(t("notPermitted"));
      const data = await res.json();
      if (!res.ok) throw new Error(errMsg(data, t("moveFailed")));
      onChanged();
      if (onOpenEntry) onOpenEntry(entry.id);
      else onClose();
      setMovingStage(false);
    } catch (caught) {
      // The server's own explanation (the 422 "route through Offer", the 409
      // "changed since you opened it") is the sentence that says what to do instead.
      setMoveErr(caught instanceof Error && caught.message ? caught.message : t("moveFailed"));
      setMovingStage(false);
    }
  };

  // Clearing the flag drops the entry from its degraded cohort, so this one closes.
  const resolveIntake = async () => {
    setResolvingIntake(true);
    setIntakeErr(null);
    try {
      const res = await fetch(`/api/pipeline/${encodeURIComponent(entry.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve_intake" }),
      });
      if (res.status === 401 || res.status === 403) {
        setIntakeErr(t("notPermitted"));
        setResolvingIntake(false);
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(errMsg(data, t("clearFlagFailed")));
      onChanged();
      onClose();
    } catch {
      setIntakeErr(t("clearFlagFailed"));
      setResolvingIntake(false);
    }
  };

  // The evidence as the modal sees it: what the entry carried, else this session's run
  // (the entry prop is frozen until the board reloads).
  const github = entry.githubEvidence ?? ghRun;
  const runGithubDeepDive = async () => {
    if (!entry.githubHandle || ghBusy) return;
    setGhBusy(true);
    setGhErr(null);
    try {
      const res = await fetch("/api/github-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // No JD text on the board payload: jobFitSignals honestly report "no JD provided".
        body: JSON.stringify({ profile: entry.githubHandle, jobDescriptionText: "" }),
      });
      const payload = await res.json();
      // Soft failures (rate limits) answer 200 + {error, code}: `error` is the discriminator.
      if (payload && typeof payload === "object" && "error" in payload) {
        throw new Error(ghErrMsg(payload, t("githubRunFailed")));
      }
      const parsed = githubAnalysisSchema.safeParse(payload);
      if (!res.ok || !parsed.success) throw new Error(t("githubRunFailed"));
      const summary = buildGithubEvidenceSummary(parsed.data);
      const save = await fetch(`/api/pipeline/${encodeURIComponent(entry.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_github", github: summary }),
      });
      if (save.status === 401 || save.status === 403) throw new Error(t("notPermitted"));
      if (!save.ok) throw new Error(t("githubRunFailed"));
      setGhRun(summary);
      onChanged();
    } catch (caught) {
      setGhErr(caught instanceof Error && caught.message ? caught.message : t("githubRunFailed"));
    } finally {
      setGhBusy(false);
    }
  };

  return {
    movingStage, moveErr, moveStage,
    resolvingIntake, intakeErr, resolveIntake,
    ghBusy, ghErr, github, runGithubDeepDive,
  };
}
