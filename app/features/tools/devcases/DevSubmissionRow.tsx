"use client";

import { AlertTriangle, Clock, GitBranch, Loader2, Mail, MessageSquare, RotateCcw, Sparkles, UserSearch } from "lucide-react";
import { useTranslations } from "next-intl";
import { GithubAnalysisPanel } from "@/app/_components/GithubAnalysisPanel";
import { StatusChip } from "@/app/_components/StatusChip";
import { submissionStatusTone } from "@/app/_lib/status-tone";
import { scoreTone, type ScoreTone } from "@/app/_lib/format";
import { EvalPanel } from "./DevEvalPanel";
import { useDevSubmissionRow } from "./useDevSubmissionRow";
import { DevSubmissionRowOutcome } from "./DevSubmissionRowOutcome";
import { DevSubmissionRowSkillProfile } from "./DevSubmissionRowSkillProfile";
import { DevVoiceScreenPanel } from "./DevVoiceScreenPanel";
import { DevSessionEvidencePanel } from "./DevSessionEvidencePanel";
import { sessionIdFromRepoRef } from "./devcase-session-evidence";
import type { Submission } from "./DevTypes";

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
  channel,
}: {
  submission: Submission;
  rank: number | null;
  isTop?: boolean;
  onChanged: () => void;
  /** GH4 — role-spec text handed to the author's-GitHub assessment so its
   *  job-fit signals read against the actual role being hired for. */
  jdText?: string;
  /** 99288c0e — the posting channel this submission arrived through, shown when
   *  the row sits in the case-wide cross-channel shortlist (omitted per-posting). */
  channel?: string;
}) {
  // Producer-owned vocabulary (the DB writes the value), so the has-guard stays:
  // a status this catalog has not learned yet renders raw rather than throwing.
  const tStatus = useTranslations("devcase.submissionStatus");
  const tRow = useTranslations("devcase.submissionRow");
  const {
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
  } = useDevSubmissionRow({ submission, jdText, onChanged });

  return (
    <li className={`rounded-md border p-2 ${isTop ? "border-moss/30 bg-moss/5 ring-1 ring-moss/40" : "border-stone-100 bg-paper/40"}`}>
      {/* bug-ui-scan-2026-07-09 (dev-submissions-live-work-surface #4): split the old
          single micro-type row into a primary IDENTITY line (who + fit score, the
          recruiter's first read, name promoted one step in the type scale) and a
          SECONDARY actions cluster that wraps as one unit — so the candidate name no
          longer competes at equal weight with three utility buttons and the layout
          stays predictable across the narrow dev-studio drawer. */}
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-micro">
          {rank ? (
            <span className={`shrink-0 rounded px-1 text-micro font-bold text-white ${rank === 1 ? "bg-moss" : "bg-ink"}`}>#{rank}</span>
          ) : null}
          {isTop ? (
            <span className="shrink-0 rounded-full bg-moss/15 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-moss">
              Top match
            </span>
          ) : null}
          {channel ? (
            <span className="shrink-0 rounded-full bg-paper px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-steel">
              {channel}
            </span>
          ) : null}
          {/* ONE THREAD (gap 8) — `dev_submissions.status` was the one axis on the
              thread that had no surface at all: the row showed a rank, a channel and
              a fit score, and whether the work had actually been EVALUATED yet was
              inferable only from the presence of that score. Now it is the same chip
              the four other axes use, so "still being evaluated" reads as work in
              flight rather than as a missing number. */}
          {submission.status ? (
            <StatusChip
              tone={submissionStatusTone(submission.status)}
              label={tStatus.has(submission.status as "received") ? tStatus(submission.status as "received") : submission.status}
              className="shrink-0 uppercase"
            />
          ) : null}
          <GitBranch size={12} className="shrink-0 text-steel" />
          {/* Identity, promoted to text-body so who this is outranks the utilities. */}
          <span className="shrink-0 text-body font-semibold text-ink">{submission.candidateRef}</span>
          {ts != null ? (
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-micro font-semibold nums ${CHIP_TONE[scoreTone(ts)]}`}
              aria-label={`Transfer fit score ${ts} of 100`}
            >
              {ts}<span className="opacity-70"> fit</span>
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate text-steel">{submission.repoRef}</span>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-micro">
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
          {/* d142462d — evaluated but not promoted: offer a kind feedback brief so
              the candidate isn't ghosted. Queued to the outbox for the recruiter. */}
          {ev && !isPromoted ? (
            <button
              type="button"
              onClick={queueFeedback}
              disabled={feedback === "queuing" || feedback === "queued"}
              title="Queue a kind strengths/growth note to the outbox (you send it; the adverse decision stays yours)"
              className="focus-ring inline-flex h-6 shrink-0 items-center gap-1 rounded border border-stone-200 bg-white px-1.5 text-micro font-semibold text-steel hover:bg-paper hover:text-ink disabled:opacity-50"
            >
              <MessageSquare size={10} />{" "}
              {feedback === "queued"
                ? "Feedback queued"
                : feedback === "queuing"
                  ? "Queuing…"
                  : feedback === "error"
                    ? "Retry feedback"
                    : "Send feedback"}
            </button>
          ) : null}
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-micro text-steel">
        {submission.contact ? (
          submission.contact.includes("@") ? (
            <a
              href={`mailto:${submission.contact}`}
              className="focus-ring inline-flex items-center gap-1 underline-offset-2 hover:text-ink hover:underline"
            >
              <Mail size={10} aria-hidden /> {submission.contact}
            </a>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Mail size={10} aria-hidden /> {submission.contact}
            </span>
          )
        ) : (
          // Only the lenient webhook path can produce this now (the public form
          // requires contact) — the recruiter must see the gap BEFORE promoting.
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-amber-700">
            <AlertTriangle size={10} aria-hidden /> No contact — unreachable if promoted
          </span>
        )}
        {/* How far past the timebox this attempt ran. Recorded, never refused (the
            finalize door accepts a late submission by design), so this is the ONLY place
            the difference between a 90-minute attempt and an eight-hour one is visible.
            Rendered only when there is something to say: 0 and null both stay silent,
            because "inside the box" is the expected case and "not measured" is not a
            fact about the candidate. */}
        {typeof submission.overTimeboxMinutes === "number" && submission.overTimeboxMinutes > 0 ? (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-amber-700"
            title={tRow("overTimeboxTitle")}
          >
            <Clock size={10} aria-hidden /> {tRow("overTimebox", { minutes: submission.overTimeboxMinutes })}
          </span>
        ) : null}
        {submission.notes ? <span className="min-w-0 flex-1 truncate italic" title={submission.notes}>“{submission.notes}”</span> : null}
      </div>
      {ghOpen ? (
        <div className="mt-2">
          <GithubAnalysisPanel status={gh.status} analysis={gh.analysis} error={gh.error} onRetry={assessAuthor} />
        </div>
      ) : null}
      {/* bug-ui-scan-2026-07-09 (dev-submissions-live-work-surface #3): give the pending
          evaluation a visible target on a first-ever run (busy with no prior bundle). */}
      {evalView.busy && !ev ? (
        <div className="mt-2 flex items-center gap-1.5 rounded-md border border-stone-200 bg-paper/60 px-2 py-1.5 text-micro text-steel" aria-live="polite">
          <Loader2 size={12} className="shrink-0 animate-spin" aria-hidden /> Evaluating this submission…
        </div>
      ) : null}
      {/* A failed/interrupted evaluation (or an unfetchable result) now shows the cause +
          a Retry, instead of the button silently reverting to "Evaluate" as if nothing ran. */}
      {evalView.failed ? (
        <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-coral/30 bg-coral/5 px-2 py-1.5 text-micro text-coral">
          <AlertTriangle size={12} className="shrink-0" aria-hidden />
          <span className="min-w-0">{evalView.message}</span>
          <button
            type="button"
            onClick={evaluate}
            className="focus-ring ml-auto inline-flex shrink-0 items-center gap-1 rounded border border-coral/40 bg-white px-1.5 py-0.5 font-semibold text-coral hover:bg-coral/10"
          >
            <RotateCcw size={10} aria-hidden /> Retry
          </button>
        </div>
      ) : null}
      {ev ? <EvalPanel ev={ev} onPromote={promote} promoted={isPromoted} promoting={promoting} /> : null}
      {/* Gap #1 — the raw evidence behind every verdict above. Gated on the submission
          being an in-product SESSION (a repo submission has no transcript and no
          observed tree), NOT on `ev`: the evidence exists from the moment the candidate
          submits, and a reviewer who wants to read it before running an evaluation is
          exactly the reader this closes the gap for. */}
      {sessionIdFromRepoRef(submission.repoRef) ? (
        <DevSessionEvidencePanel
          sessionId={sessionIdFromRepoRef(submission.repoRef)!}
          judgeIndependence={ev?.judgeIndependence}
        />
      ) : null}
      {/* ONE THREAD (gap 4) — the voice screen that verifies this evaluation, reachable
          from the evaluation. Gated on `ev` for the same reason /api/interview/create
          is: the screen's brief is built from the evaluation's own minted follow-ups,
          so there is nothing grounded to ask before one exists. */}
      {ev ? <DevVoiceScreenPanel submissionId={submission.id} /> : null}
      {ev ? <DevSubmissionRowSkillProfile dsp={dsp} onIssue={issueProfile} /> : null}
      {isPromoted ? (
        <DevSubmissionRowOutcome
          recorded={recorded}
          outcome={outcome}
          setOutcome={setOutcome}
          recordSubmissionOutcome={recordSubmissionOutcome}
        />
      ) : null}
    </li>
  );
}
