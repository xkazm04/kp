"use client";

// The work-sample half of the evidence ladder (ADR 0027 S3): the evaluation bundle the
// WATCHED rung reads and the debrief readout the DEFENDED rung reads. Both come through
// doors that already exist, so S3 adds no route:
//
//   GET /api/pipeline/[id]                         the entry, carrying devCaseId/devSubmissionId
//                                                  (the board poll strips them; this read does not)
//   GET /api/devcase/[caseId]/channels             the case's postings with submissions inlined,
//                                                  each with its persisted evaluation
//   GET /api/interview-prep/scorecard?debrief=<s>  the C4 findings readout for that submission
//
// An entry with no work sample stops after the first read. Read-only: nothing here writes.

import { useEffect, useState } from "react";
import type { DebriefReadoutInput } from "@/app/_lib/evidence-ladder/ladder";

export type WorkSampleEvidence =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; submission: boolean; evaluation: unknown; debrief: DebriefReadoutInput | null };

async function readJson(url: string, signal: AbortSignal): Promise<Record<string, unknown> | null> {
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  const body: unknown = await res.json().catch(() => null);
  return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
}

function submissionEvaluation(channels: Record<string, unknown> | null, submissionId: string): unknown {
  const postings = Array.isArray(channels?.postings) ? (channels.postings as Array<{ submissions?: unknown }>) : [];
  for (const posting of postings) {
    const subs = Array.isArray(posting?.submissions) ? (posting.submissions as Array<{ id?: unknown; evaluation?: unknown }>) : [];
    const hit = subs.find((s) => s?.id === submissionId);
    if (hit) return hit.evaluation ?? null;
  }
  return null;
}

export function useWorkSampleEvidence(entryId: string): WorkSampleEvidence {
  // Keyed on the entry it was read for, so a different candidate reads "loading" until its
  // own evidence lands and the previous one's never paints under the new header.
  const [state, setState] = useState<{ for: string; value: WorkSampleEvidence }>({ for: entryId, value: { status: "loading" } });

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const settle = (value: WorkSampleEvidence) => {
      if (!signal.aborted) setState({ for: entryId, value });
    };
    (async () => {
      const got = await readJson(`/api/pipeline/${encodeURIComponent(entryId)}`, signal);
      const entry = got?.entry as { devCaseId?: unknown; devSubmissionId?: unknown } | undefined;
      if (!entry) return settle({ status: "failed" });
      const caseId = typeof entry.devCaseId === "string" && entry.devCaseId ? entry.devCaseId : null;
      const submissionId = typeof entry.devSubmissionId === "string" && entry.devSubmissionId ? entry.devSubmissionId : null;
      // An assignment sent but nothing submitted yet is a work sample with no evaluation.
      if (!submissionId) return settle({ status: "ready", submission: caseId !== null, evaluation: null, debrief: null });
      const [channels, debrief] = await Promise.all([
        caseId ? readJson(`/api/devcase/${encodeURIComponent(caseId)}/channels`, signal) : Promise.resolve(null),
        readJson(`/api/interview-prep/scorecard?debrief=${encodeURIComponent(submissionId)}`, signal),
      ]);
      if (caseId && !channels) return settle({ status: "failed" });
      settle({
        status: "ready",
        submission: true,
        evaluation: submissionEvaluation(channels, submissionId),
        debrief: debrief as DebriefReadoutInput | null,
      });
    })().catch(() => settle({ status: "failed" }));
    return () => controller.abort();
  }, [entryId]);

  return state.for === entryId ? state.value : { status: "loading" };
}
