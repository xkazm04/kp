"use client";

import { Check, Plus } from "lucide-react";
import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { buildGithubEvidenceSummary } from "@/app/_lib/github-summary";
import type { GithubAnalysis } from "@/app/_lib/schemas";
import { postPipelineAdd, type PipelineAddInput } from "@/app/_lib/useAddToPipeline";
import { capabilityAwareReason, useErrorMessage } from "@/app/_lib/use-error-message";
import { BTN_AFFIRM } from "@/app/_components/ui/recipes";

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
  // The refusal is rendered from its CODE in the reader's language — the door's
  // English `error` never reaches this line (see app/_lib/use-error-message.ts).
  const errMsg = useErrorMessage();
  const [state, setState] = useState<"idle" | "adding" | "added">("idle");
  const [error, setError] = useState<string | null>(null);
  const statusId = useId();

  const onClick = async () => {
    if (state !== "idle") return;
    setState("adding");
    setError(null);
    const result = await postPipelineAdd(pipelineRef.jobId, pipelineRef.jobTitle, {
      source: "analyze",
      ...pipelineRef,
      github: github ? buildGithubEvidenceSummary(github) : pipelineRef.github,
    });
    if (result.ok) {
      setState("added");
    } else {
      setState("idle");
      // A capability refusal names the permission the seat is missing; anything
      // else resolves through errors.<CODE>, and an uncoded door falls back to
      // this surface's own localized line.
      setError(capabilityAwareReason(errMsg, result, t("addFailed")));
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
        // The success state is the app's affirmative-action recipe, not a one-off
        // fill: `bg-green-600` was the ONLY green-600 in app/ and its dark value is a
        // light mint (#7ec48d in globals.css), so white-on-it read at ~1.9:1 in Spark
        // Dark. BTN_AFFIRM is moss in both registers, like every other positive-half
        // button. `disabled:opacity-100` because the button IS disabled once added —
        // that is a DONE state, not an unavailable one, and the recipe's dim would
        // fade the confirmation the recruiter just earned.
        className={
          added
            ? `${BTN_AFFIRM} h-10 cursor-default justify-center px-4 text-base disabled:opacity-100`
            : "focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-md bg-ink px-4 text-base font-semibold text-white transition-colors hover:bg-ink/90 disabled:opacity-60"
        }
      >
        {added ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        {added ? t("added") : state === "adding" ? t("adding") : t("addToPipeline")}
      </button>
      {/* aria-live so the outcome is announced; visible only on failure (success
          is conveyed by the button's own state change). */}
      <p id={statusId} role="status" aria-live="polite" className="min-h-0 text-sm text-red-700">
        {error ?? ""}
      </p>
    </div>
  );
}
