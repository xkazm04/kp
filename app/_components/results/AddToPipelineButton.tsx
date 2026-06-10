"use client";

import { Check, Plus } from "lucide-react";
import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { buildGithubEvidenceSummary } from "@/app/_lib/github-summary";
import type { GithubAnalysis } from "@/app/_lib/schemas";
import { postPipelineAdd, type PipelineAddInput } from "@/app/_lib/useAddToPipeline";

// Everything POST /api/pipeline needs to file this candidate under a role. The
// candidate fields reuse the canonical PipelineAddInput (so this surface can't
// drift from the recruiter-candidates / rediscovery / match surfaces), plus the
// job the analysis was run against. jobId is required by the API — only render
// this when the caller can supply one (e.g. the analysis has a saved JD).
export type PipelineRef = PipelineAddInput & { jobId: string; jobTitle: string };

// "Add to pipeline" from a candidate report. Closes the dead-end where a
// recruiter reviews a job-fit result and then has nowhere to act — the same
// optimistic add the Match results already offer, surfaced on the report. State
// is local (one candidate, one button); the network call + its error handling
// live in the shared postPipelineAdd so they're tested in one place.
// `github` (GH2): when the report carries a done GitHub deep-dive, a compact
// evidence summary rides the add so the drawer / Decisions surfaces see
// corroborated-vs-claimed skills, not just a score.
export function AddToPipelineButton({
  pipelineRef,
  github,
}: {
  pipelineRef: PipelineRef;
  github?: GithubAnalysis | null;
}) {
  const t = useTranslations("report");
  const [state, setState] = useState<"idle" | "adding" | "added">("idle");
  const [error, setError] = useState<string | null>(null);
  const statusId = useId();

  const onClick = async () => {
    if (state !== "idle") return;
    setState("adding");
    setError(null);
    const result = await postPipelineAdd(pipelineRef.jobId, pipelineRef.jobTitle, {
      ...pipelineRef,
      github: github ? buildGithubEvidenceSummary(github) : pipelineRef.github,
    });
    if (result.ok) {
      setState("added");
    } else {
      setState("idle");
      setError(result.message);
    }
  };

  const added = state === "added";

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={state !== "idle"}
        aria-describedby={error ? statusId : undefined}
        className={`focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-base font-semibold transition-colors ${
          added
            ? "cursor-default bg-green-600 text-white"
            : "bg-ink text-white hover:bg-ink/90 disabled:opacity-60"
        }`}
      >
        {added ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        {added ? t("added") : state === "adding" ? t("adding") : t("addToPipeline")}
      </button>
      {/* aria-live so the outcome is announced; visible only on failure (success
          is conveyed by the button's own state change). */}
      <p id={statusId} role="status" aria-live="polite" className="min-h-0 text-sm text-red-700">
        {error ? t("addFailed", { error }) : ""}
      </p>
    </div>
  );
}
