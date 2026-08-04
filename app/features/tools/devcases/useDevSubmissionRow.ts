// All per-row state + network calls for DevSubmissionRow.tsx: author-GitHub
// assessment, Durable Skill Profile issuance, outcome recording, evaluate/promote/
// feedback. Split out so the component file is render-only wiring.
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useTasks, useTaskResult } from "@/app/features/shell/tasks/TasksProvider";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { useGithubErrorMessage } from "@/app/_lib/use-github-error";
import { assertScore } from "@/app/_lib/format";
import { parseRepoRef } from "@/app/_lib/repo-snapshot";
import { githubAnalysisSchema, type GithubAnalysis } from "@/app/_lib/schemas";
import { evalTaskView } from "./devEvalTaskState";
import type { EvalBundle, Submission } from "./DevTypes";

export function useDevSubmissionRow({
  submission,
  jdText,
  onChanged,
}: {
  submission: Submission;
  jdText?: string;
  onChanged: () => void;
}) {
  const { startTask } = useTasks();
  // Resolve API failures from the machine `code`, never from the server's
  // English `error` — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  // The GitHub deep-dive answers with its own code namespace (results.github.errors).
  const ghErrMsg = useGithubErrorMessage();
  const tGhErr = useTranslations("results.github.errors");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [promoted, setPromoted] = useState(false);
  const [promoting, setPromoting] = useState(false);
  // GH4 — the submitter's broader public profile, one click from the repo in
  // hand. parseRepoRef(repoRef).owner IS their username; the dev-case eval only
  // ever reads the submission repo, so this joins the two halves (this-task
  // performance + durable skill pattern) on the one surface holding both.
  const [ghOpen, setGhOpen] = useState(false);
  const [gh, setGh] = useState<{
    status: "idle" | "loading" | "done" | "error";
    analysis: GithubAnalysis | null;
    error: string | null;
  }>({ status: "idle", analysis: null, error: null });
  const owner = submission.repoRef ? parseRepoRef(submission.repoRef)?.owner ?? null : null;

  // Durable Skill Profile (moonshot A): mint a signed, candidate-owned credential
  // from this graded submission. The button is recruiter-facing (dev studio);
  // the returned token links to the public, shareable score-card.
  const [dsp, setDsp] = useState<{ status: "idle" | "issuing" | "done" | "error"; token: string | null }>({ status: "idle", token: null });
  const issueProfile = async () => {
    setDsp({ status: "issuing", token: null });
    try {
      const r = await fetch("/api/devcase/skill-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId: submission.id }),
      });
      const data = (await r.json()) as { token?: string };
      if (!r.ok || !data.token) throw new Error("issue failed");
      setDsp({ status: "done", token: data.token });
    } catch {
      setDsp({ status: "error", token: null });
    }
  };

  const assessAuthor = async () => {
    if (!owner) return;
    setGh({ status: "loading", analysis: null, error: null });
    try {
      const r = await fetch("/api/github-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: owner, jobDescriptionText: jdText ?? "" }),
      });
      const payload = await r.json();
      // The route returns 200 + {error, code} for soft failures (rate limits), so the
      // presence of `error` — not the HTTP status — is the failure discriminator. The
      // `code` half is what gets shown; the English `error` half is the server's log line.
      if (payload && typeof payload === "object" && "error" in payload) {
        throw new Error(ghErrMsg(payload, tGhErr("ANALYSIS_FAILED")));
      }
      if (!r.ok) throw new Error(tGhErr("ANALYSIS_FAILED"));
      setGh({ status: "done", analysis: githubAnalysisSchema.parse(payload), error: null });
    } catch (caught) {
      setGh({
        status: "error",
        analysis: null,
        error: caught instanceof Error && caught.message ? caught.message : tGhErr("ANALYSIS_FAILED"),
      });
    }
  };

  const toggleAuthorGithub = () => {
    const opening = !ghOpen;
    setGhOpen(opening);
    // Fetch on first open only — re-opens reuse the held result (and the
    // route's TTL cache absorbs a genuine re-fetch after an error retry).
    if (opening && gh.status === "idle") void assessAuthor();
  };

  // W5-2 (DEVS2) — one-click outcome recording where the recruiter already is.
  // The calibration loop only converges if recording reality is nearly free;
  // the control-room form demanded hand-transcribed candidateRef + predicted
  // score, both of which this row already knows (and `ref` — the submission id
  // the schema reserves for traceability — which no UI ever populated).
  const [outcome, setOutcome] = useState<{
    recorded: "hired" | "rejected" | "withdrawn" | null;
    pickingPerf: boolean;
    busy: boolean;
    error: string | null;
  }>({ recorded: null, pickingPerf: false, busy: false, error: null });
  // Server truth first: the postings GET joins each submission's latest recorded outcome
  // from the dev-outcomes store (ref === submission.id), so a remount shows the pill
  // instead of re-offering the buttons — a re-click used to persist a second row that
  // calibrate() counted as another decided outcome. Local state stays the optimistic
  // layer for the click that just landed; "pending" is undecided, so it keeps the buttons.
  const serverRecorded =
    submission.outcome && submission.outcome.outcome !== "pending" ? submission.outcome.outcome : null;
  const recorded = outcome.recorded ?? serverRecorded;

  const recordSubmissionOutcome = async (kind: "hired" | "rejected" | "withdrawn", performance?: number) => {
    if (outcome.busy || recorded) return;
    setOutcome((o) => ({ ...o, busy: true, error: null, pickingPerf: false }));
    try {
      const r = await fetch("/api/devcase/outcomes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ref: submission.id,
          candidateRef: submission.candidateRef ?? undefined,
          predictedScore: submission.transferScore ?? undefined,
          outcome: kind,
          ...(performance ? { performance } : {}),
        }),
      });
      const payload = (await r.json().catch(() => null)) as { error?: string; code?: string } | null;
      if (!r.ok) throw new Error(errMsg(payload, "Couldn't record the outcome."));
      setOutcome({ recorded: kind, pickingPerf: false, busy: false, error: null });
    } catch (caught) {
      setOutcome((o) => ({
        ...o,
        busy: false,
        error: caught instanceof Error ? caught.message : "Couldn't record the outcome.",
      }));
    }
  };
  // Server truth OR the local just-clicked flag: an already-promoted submission — earlier
  // this session before a reload, or auto-promoted by the lifecycle pipeline — must not
  // re-expose the Promote button, since a second promote re-sends the invite from the outbox.
  const isPromoted = promoted || submission.status === "promoted";
  const seen = useRef(false);
  // The poll omits the eval bundle; useTaskResult fetches it on demand once the
  // evaluate task finishes. `fresh` stays null during that brief fetch, falling
  // back to the submission's saved evaluation.
  // bug-ui-scan-2026-07-09 (dev-submissions-live-work-surface #3): also read the hook's
  // `error` + `resultUnavailable` so a failed/interrupted evaluation surfaces a cause +
  // Retry instead of silently reverting to "Evaluate" (it used to look like a no-op).
  const { status: evalStatus, full: evalFull, error: evalError, resultUnavailable } = useTaskResult(taskId);
  const evalView = evalTaskView({ status: evalStatus, error: evalError, resultUnavailable });
  const busy = evalView.busy;
  const fresh = evalStatus === "succeeded" ? ((evalFull?.result as EvalBundle | undefined) ?? null) : null;
  const ev = fresh ?? submission.evaluation ?? null;

  // reload postings once when the evaluate task lands (so the score persists into the list)
  useEffect(() => {
    if (evalStatus === "succeeded" && !seen.current) {
      seen.current = true;
      onChanged();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evalStatus]);

  const evaluate = async () => {
    seen.current = false;
    const t = await startTask("evaluate_submission", { submissionId: submission.id, candidateRef: submission.candidateRef });
    if (t) setTaskId(t.id);
  };
  // d142462d — queue a kind, non-adverse feedback brief for a candidate who won't
  // be promoted, so the take-home doesn't end in silence. Lands in the outbox as a
  // queued row the recruiter sends; the adverse decision stays human-gated.
  const [feedback, setFeedback] = useState<"idle" | "queuing" | "queued" | "error">("idle");
  const queueFeedback = async () => {
    if (feedback === "queuing" || feedback === "queued") return;
    setFeedback("queuing");
    try {
      const r = await fetch("/api/devcase/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId: submission.id }),
      });
      setFeedback(r.ok ? "queued" : "error");
    } catch {
      setFeedback("error");
    }
  };

  const promote = async () => {
    if (promoting || isPromoted) return; // in-flight + already-promoted double-promote guard
    setPromoting(true);
    try {
      const r = await fetch("/api/devcase/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId: submission.id }),
      });
      if (r.ok) setPromoted(true);
    } finally {
      setPromoting(false);
    }
  };

  // Source the fit chip from the SAME persisted score the parent list sorts/ranks on, not the
  // in-memory eval bundle. Otherwise, in the gap between "eval succeeded" and the onChanged
  // postings reload, the row showed a fresh "82 fit" chip while the list (reading persisted
  // null) sorted it last with no #rank — a self-contradictory ordering. Both now go empty
  // during that gap and populate together after the reload (a brief, consistent flicker).
  const tsRaw = submission.transferScore ?? null;
  // Guard the 0..100 score domain before it tones/labels the fit chip.
  const ts = tsRaw == null ? null : assertScore(tsRaw, "transferScore");

  return {
    owner,
    ghOpen, gh, toggleAuthorGithub, assessAuthor,
    dsp, issueProfile,
    outcome, setOutcome, recorded, recordSubmissionOutcome,
    isPromoted,
    evalView, busy, ev,
    evaluate,
    feedback, queueFeedback,
    promote, promoting,
    ts,
  };
}
