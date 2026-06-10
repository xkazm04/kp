"use client";

import { useEffect, useRef, useState } from "react";
import { GitBranch, Sparkles, UserSearch } from "lucide-react";
import { useTasks, useTaskResult } from "@/app/features/tasks/TasksProvider";
import { GithubAnalysisPanel } from "@/app/_components/GithubAnalysisPanel";
import { assertScore, scoreTone, type ScoreTone } from "@/app/_lib/format";
import { parseRepoRef } from "@/app/_lib/repo-snapshot";
import { githubAnalysisSchema, type GithubAnalysis } from "@/app/_lib/schemas";
import { EvalPanel } from "./EvalPanel";
import type { EvalBundle, Submission } from "./DevTypes";

// The transfer-fit chip on the canonical score scale — scoreTone owns the 75/50
// cutoffs, so a fit score can never read strong-green here yet mid on a badge or
// dial elsewhere (the four-band 72/55/40 dev scale this replaced silently did).
// Solid `--color-score-*` fill with a legible foreground: white on the darker
// moss/coral bands, ink on the lighter amber mid band.
const CHIP_TONE: Record<ScoreTone, string> = {
  strong: "bg-score-strong text-white",
  mid: "bg-score-mid text-ink",
  weak: "bg-score-weak text-white",
  null: "bg-score-null text-white",
};

export function SubmissionRow({
  submission,
  rank,
  isTop = false,
  onChanged,
  jdText,
}: {
  submission: Submission;
  rank: number | null;
  isTop?: boolean;
  onChanged: () => void;
  /** GH4 — role-spec text handed to the author's-GitHub assessment so its
   *  job-fit signals read against the actual role being hired for. */
  jdText?: string;
}) {
  const { startTask } = useTasks();
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
      // The route returns 200 + {error} for soft failures (rate limits).
      if (payload && typeof payload === "object" && typeof payload.error === "string") {
        throw new Error(payload.error);
      }
      if (!r.ok) throw new Error("GitHub analysis failed.");
      setGh({ status: "done", analysis: githubAnalysisSchema.parse(payload), error: null });
    } catch (caught) {
      setGh({
        status: "error",
        analysis: null,
        error: caught instanceof Error ? caught.message : "GitHub analysis failed.",
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

  const recordSubmissionOutcome = async (kind: "hired" | "rejected" | "withdrawn", performance?: number) => {
    if (outcome.busy || outcome.recorded) return;
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
      const payload = (await r.json().catch(() => null)) as { error?: string } | null;
      if (!r.ok) throw new Error(payload?.error ?? "Couldn't record the outcome.");
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
  const { status: evalStatus, full: evalFull } = useTaskResult(taskId);
  const busy = evalStatus === "running" || evalStatus === "queued";
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

  return (
    <li className={`rounded-md border p-2 ${isTop ? "border-moss/30 bg-moss/5 ring-1 ring-moss/40" : "border-stone-100 bg-paper/40"}`}>
      <div className="flex items-center gap-1.5 text-micro">
        {rank ? (
          <span className={`shrink-0 rounded px-1 text-micro font-bold text-white ${rank === 1 ? "bg-moss" : "bg-ink"}`}>#{rank}</span>
        ) : null}
        {isTop ? (
          <span className="shrink-0 rounded-full bg-moss/15 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-moss">
            Top match
          </span>
        ) : null}
        <GitBranch size={11} className="shrink-0 text-steel" />
        <span className="font-semibold text-ink">{submission.candidateRef}</span>
        <span className="min-w-0 flex-1 truncate text-steel">{submission.repoRef}</span>
        {ts != null ? (
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-micro font-semibold nums ${CHIP_TONE[scoreTone(ts)]}`}
            aria-label={`Transfer fit score ${ts} of 100`}
          >
            {ts}<span className="opacity-70"> fit</span>
          </span>
        ) : null}
        {owner ? (
          <button
            type="button"
            onClick={toggleAuthorGithub}
            aria-expanded={ghOpen}
            title={`Assess @${owner}'s public GitHub profile against this role`}
            className="focus-ring inline-flex h-6 shrink-0 items-center gap-1 rounded border border-stone-200 bg-white px-1.5 text-micro font-semibold text-steel hover:bg-paper hover:text-ink"
          >
            <UserSearch size={10} /> {ghOpen ? "Hide author" : "Author's GitHub"}
          </button>
        ) : null}
        <button type="button" onClick={evaluate} disabled={busy}
          className="focus-ring inline-flex h-6 shrink-0 items-center gap-1 rounded border border-stone-200 bg-white px-1.5 text-micro font-semibold text-coral hover:bg-coral/5 disabled:opacity-50">
          <Sparkles size={10} /> {busy ? "Evaluating…" : ev ? "Re-evaluate" : "Evaluate"}
        </button>
      </div>
      {ghOpen ? (
        <div className="mt-2">
          <GithubAnalysisPanel status={gh.status} analysis={gh.analysis} error={gh.error} onRetry={assessAuthor} />
        </div>
      ) : null}
      {ev ? <EvalPanel ev={ev} onPromote={promote} promoted={isPromoted} promoting={promoting} /> : null}
      {isPromoted ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-micro">
          {outcome.recorded ? (
            <span
              className={`rounded-full px-2 py-0.5 font-semibold uppercase ${
                outcome.recorded === "hired" ? "bg-moss/15 text-moss" : "bg-stone-100 text-steel"
              }`}
            >
              outcome: {outcome.recorded} ✓
            </span>
          ) : outcome.pickingPerf ? (
            <>
              <span className="uppercase tracking-wide text-steel">On-the-job perf</span>
              {[1, 2, 3, 4, 5].map((perf) => (
                <button
                  key={perf}
                  type="button"
                  disabled={outcome.busy}
                  onClick={() => void recordSubmissionOutcome("hired", perf)}
                  className="focus-ring h-6 w-6 rounded border border-stone-200 bg-white font-semibold text-ink hover:border-moss/50 hover:bg-moss/5 disabled:opacity-50"
                >
                  {perf}
                </button>
              ))}
              <button
                type="button"
                disabled={outcome.busy}
                onClick={() => void recordSubmissionOutcome("hired")}
                className="focus-ring rounded border border-stone-200 bg-white px-1.5 py-0.5 font-semibold text-steel hover:text-ink disabled:opacity-50"
              >
                skip — record hire only
              </button>
            </>
          ) : (
            <>
              <span className="uppercase tracking-wide text-steel" title="Feed the promote-floor calibration with what actually happened">
                Outcome
              </span>
              <button
                type="button"
                disabled={outcome.busy}
                onClick={() => setOutcome((o) => ({ ...o, pickingPerf: true, error: null }))}
                className="focus-ring rounded border border-moss/40 bg-white px-1.5 py-0.5 font-semibold text-moss hover:bg-moss/5 disabled:opacity-50"
              >
                Hired
              </button>
              <button
                type="button"
                disabled={outcome.busy}
                onClick={() => void recordSubmissionOutcome("rejected")}
                className="focus-ring rounded border border-stone-200 bg-white px-1.5 py-0.5 font-semibold text-coral hover:bg-coral/5 disabled:opacity-50"
              >
                Rejected
              </button>
              <button
                type="button"
                disabled={outcome.busy}
                onClick={() => void recordSubmissionOutcome("withdrawn")}
                className="focus-ring rounded border border-stone-200 bg-white px-1.5 py-0.5 font-semibold text-steel hover:text-ink disabled:opacity-50"
              >
                Withdrawn
              </button>
            </>
          )}
          {outcome.error ? (
            <span role="alert" className="text-red-700">
              {outcome.error}
            </span>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
