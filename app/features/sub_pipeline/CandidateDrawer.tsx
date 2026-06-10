"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeftRight, Ban, Banknote, Calendar, ClipboardList, ExternalLink, GitBranch, History, Mail, Pencil, Phone, Shuffle, Sparkles, UserCheck, Wrench, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { buildUrl } from "@/app/features/tabs";
import { useTasks, useTaskResult } from "@/app/features/tasks/TasksProvider";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { ResultView } from "./CandidateResultView";
import { useTokenLink, TokenLinkPanel } from "./TokenLink";
import { type Entry, type Result, type TaskId } from "./CandidateDrawerTypes";
import { styleFor, type PipelineEvent } from "./PipelineTypes";
import { EventDot, useEventVerb, useRelativeTime } from "./PipelineShared";
import { PIPELINE_STAGES, SCREENING_STAGES } from "@/app/_lib/pipeline-stages";
import { RUBRIC_ANCHOR_LINE } from "@/app/_lib/interview-rubric";
import { RATING_MAX } from "@/app/_lib/format";
import type { Scorecard, ScorecardRating } from "@/app/_lib/interview-scorecard";
import { initials } from "@/app/_lib/initials";

const ACTIONS: { id: TaskId; label: string; icon: typeof Mail; stages: string[] | "all"; note?: string }[] = [
  // Screening is the triage gate for both pre-interview stages (SCREENING_STAGES):
  // at Accepted it screens a fresh applicant into Screened (or into Screened held
  // for review); at Screened it advances to Interview or holds. So the top of the
  // funnel — where triage volume is highest — is now individually actionable.
  { id: "screen", label: "Screen with AI", icon: UserCheck, stages: [...SCREENING_STAGES], note: "A confident pass advances the candidate; otherwise it holds for your review in Decisions." },
  { id: "prep", label: "Interview prep", icon: ClipboardList, stages: ["Screened", "Interview"] },
  { id: "scorecard", label: "Synthesize scorecard", icon: ClipboardList, stages: ["Interview"], note: "From your notes → a structured scorecard in Decisions." },
  { id: "offer", label: "Draft offer", icon: Banknote, stages: ["Offer"], note: "Salary from the role band, scaled by fit → an offer to approve in Decisions." },
  { id: "outreach", label: "Draft outreach", icon: Mail, stages: "all" },
  { id: "rejection", label: "Draft rejection", icon: Ban, stages: ["Accepted", "Screened", "Interview", "Offer"] },
  { id: "rematch", label: "Explore alternatives", icon: Shuffle, stages: ["Screened", "Interview", "Offer"] },
];

const REC_STYLE: Record<string, string> = {
  advance: "bg-moss/15 text-moss",
  hold: "bg-dial-amber/20 text-ink",
  reject: "bg-coral/10 text-coral",
};

type InterviewOutcome = {
  recommendation?: string;
  summary?: string;
  ratings?: ScorecardRating[];
  hasTranscript?: boolean;
};

export function CandidateDrawer({ entry, onClose, onChanged }: { entry: Entry; onClose: () => void; onChanged: () => void }) {
  const router = useRouter();
  const search = useSearchParams();
  const t = useTranslations("pipeline.drawer");
  const tActions = useTranslations("pipeline.actions");
  const enumLabel = useEnumLabel();
  const eventVerb = useEventVerb();
  const relativeTime = useRelativeTime();
  const { startTask } = useTasks();
  const [busy, setBusy] = useState<TaskId | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Voice 1st-round screen and self-scheduling both mint a tokenized candidate link.
  // The shared POST/url/copy plumbing lives in useTokenLink; only the endpoint, the
  // POST body, and the surrounding panel UI differ between the two.
  const [voiceProvider, setVoiceProvider] = useState<"openai" | "elevenlabs">("openai");
  const voice = useTokenLink("/api/interview/create");
  const sched = useTokenLink("/api/schedule/invite");

  // Degraded-intake recovery: clear the flag once the profile is captured manually.
  const [resolvingIntake, setResolvingIntake] = useState(false);
  const [intakeErr, setIntakeErr] = useState<string | null>(null);

  // Manual stage override: move a candidate backward / skip / correct a
  // miscategorization — the transitions the AI accept/reject can't express.
  const [movingStage, setMovingStage] = useState(false);
  const [moveErr, setMoveErr] = useState<string | null>(null);

  // Latest completed voice interview — surfaced as an evidence source in the
  // candidate's analysis (its scorecard also feeds the Decisions gate).
  const [ivOutcome, setIvOutcome] = useState<InterviewOutcome | null>(null);
  // The recruiter's human scorecard for this candidate (PREP1), if one was filled
  // from the prep modal — surfaced here so a human-led round isn't invisible on
  // the board the way the AI voice-screen scorecard already is.
  const [humanSc, setHumanSc] = useState<Scorecard | null>(null);

  // Per-candidate history (PIPE3): the entry's events oldest→newest — applied →
  // screened → advanced → scheduled → moved → … — so a recruiter opening a
  // candidate sees the story of how they got here, not just the latest state.
  const [history, setHistory] = useState<PipelineEvent[] | null>(null);

  // Modal focus management: trap Tab within the dialog, close on Escape, and
  // restore focus to the trigger on unmount (WCAG dialog requirements).
  const dialogRef = useRef<HTMLElement | null>(null);
  // Latest-callback ref, updated in a commit-phase effect (never during render —
  // render must stay pure) so the long-lived keydown listener sees the current
  // onClose without re-binding.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    const node = dialogRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusables = () =>
      node
        ? Array.from(
            node.querySelectorAll<HTMLElement>(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            )
          ).filter((el) => !el.hasAttribute("disabled"))
        : [];
    focusables()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    node?.addEventListener("keydown", onKeyDown);
    return () => {
      node?.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    fetch(`/api/interview/by-entry?entry=${encodeURIComponent(entry.id)}`)
      .then((r) => r.json())
      .then((d) => {
        const s = d.session as { status?: string; transcript?: unknown[]; scorecard?: Scorecard | null } | null;
        if (!alive || !s || s.status !== "completed") return;
        const sc = s.scorecard ?? null;
        setIvOutcome({
          recommendation: sc?.recommendation,
          summary: sc?.summary,
          ratings: sc?.ratings,
          hasTranscript: Array.isArray(s.transcript) && s.transcript.length > 0,
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [entry.id]);

  // Load any human scorecard saved against this entry's prep artifact (PREP1).
  // Best-effort; absent for candidates no one has hand-scored.
  useEffect(() => {
    let alive = true;
    fetch(`/api/interview-prep?entry=${encodeURIComponent(entry.id)}`)
      .then((r) => r.json())
      .then((d) => {
        const sc = (d.prep?.payload as { humanScorecard?: Scorecard } | undefined)?.humanScorecard ?? null;
        if (alive) setHumanSc(sc && (sc.ratings?.length || sc.summary) ? sc : null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [entry.id]);

  // W6-4 — outcome note for the revoke-links action.
  const [revokeNote, setRevokeNote] = useState<string | null>(null);

  // W6-2 (SIM1) — the actual letters this candidate received (events say
  // "rejection_sent"; this shows the rejection). Best-effort, hides when empty.
  const [comms, setComms] = useState<
    { id: string; kind: string | null; status: string; channel: string | null; subject: string | null; body: string | null; createdAt: string }[] | null
  >(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/comms?entry=${encodeURIComponent(entry.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d) setComms((d.messages as typeof comms) ?? []);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id]);

  // Load this candidate's event timeline (PIPE3). Best-effort: a failed/empty load
  // just hides the section — the drawer's actions don't depend on it.
  useEffect(() => {
    let alive = true;
    fetch(`/api/pipeline/events?entry=${encodeURIComponent(entry.id)}`)
      .then((r) => r.json())
      .then((d) => {
        if (alive) setHistory((d.events as PipelineEvent[]) ?? []);
      })
      .catch(() => {
        if (alive) setHistory([]);
      });
    return () => {
      alive = false;
    };
  }, [entry.id]);

  const a = styleFor(entry.archetype);
  const monogram = initials(entry.candidateLabel);
  const actions = ACTIONS.filter((act) => act.stages === "all" || act.stages.includes(entry.stage)).filter(
    (act) => entry.status === "active" || act.id === "rematch"
  );

  // Run through the background-task system: the work survives closing the drawer
  // or navigating away, and a duplicate click reuses the in-flight task (dedup).
  const run = async (task: TaskId) => {
    setBusy(task);
    setError(null);
    setResult(null);
    setPendingId(null);
    const started = await startTask("automation", {
      entryId: entry.id,
      task,
      notes: task === "scorecard" ? notes : undefined,
      entryLabel: entry.candidateLabel,
    });
    if (!started) {
      setError(t("taskStartFailed"));
      setBusy(null);
      return;
    }
    setPendingId(started.id);
  };

  const resolveIntake = async () => {
    setResolvingIntake(true);
    setIntakeErr(null);
    try {
      const res = await fetch(`/api/pipeline/${encodeURIComponent(entry.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve_intake" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `resolve failed (${res.status})`);
      // The flag is cleared server-side; reload the board and close (this entry is now stale).
      onChanged();
      onClose();
    } catch {
      setIntakeErr(t("clearFlagFailed"));
      setResolvingIntake(false);
    }
  };

  // Manually move the candidate to a chosen stage. Sends expectedStage so a move
  // decided against this (possibly stale) drawer view 409s instead of clobbering a
  // concurrent change. On success the entry is stale (new stage), so reload + close
  // — same pattern as resolveIntake.
  const moveStage = async (toStage: string) => {
    if (toStage === entry.stage || movingStage) return;
    setMovingStage(true);
    setMoveErr(null);
    try {
      const res = await fetch(`/api/pipeline/${encodeURIComponent(entry.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_stage", toStage, expectedStage: entry.stage }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Move failed (${res.status})`);
      onChanged();
      onClose();
    } catch {
      setMoveErr(t("moveFailed"));
      setMovingStage(false);
    }
  };

  // Both link panels share one gate: an active candidate in a screening/interview stage.
  const showLinks = entry.status === "active" && ["Screened", "Interview"].includes(entry.stage);

  // The automation task's result + params (which `task` it ran) are fetched on
  // demand once it finishes — the poll omits both. Hold pendingId until the full
  // record lands so the drawer stays in its busy state through the brief fetch.
  // Completion is consumed DURING render (guarded: pendingId is cleared in the
  // same pass, so this runs once per task); only the parent notification stays
  // in an effect below, because onChanged touches PARENT state and render-phase
  // updates are legal only for this component's own.
  const { status: actionStatus, error: actionError, full: actionFull } = useTaskResult(pendingId);
  if (pendingId && actionStatus === "succeeded" && actionFull) {
    const data = actionFull.result as { result: Record<string, unknown>; source: string; applied: string } | null;
    const sub = (((actionFull.params as { task?: string } | null)?.task ?? busy) ?? "screen") as TaskId;
    if (data) {
      setResult({ task: sub, data: data.result, source: data.source, applied: data.applied });
    }
    setBusy(null);
    setPendingId(null);
  } else if (pendingId && (actionStatus === "failed" || actionStatus === "canceled" || actionStatus === "interrupted")) {
    setError(actionError ?? t("taskIncomplete"));
    setBusy(null);
    setPendingId(null);
  }

  // Post-commit parent notification: an applied action changed the entry, so the
  // board behind the drawer must reload. Keyed on the consumed result object (a
  // fresh object per completion → fires once per applied task); reads onChanged
  // through the latest-ref so a parent re-render can't re-trigger a reload.
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  });
  const appliedResult =
    result && ["advanced", "held_for_review", "scorecard_ready", "offer_ready", "rematched"].includes(result.applied)
      ? result
      : null;
  useEffect(() => {
    if (appliedResult) onChangedRef.current();
  }, [appliedResult]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label={t("close")} onClick={onClose} className="absolute inset-0 bg-ink/20 backdrop-blur-[1px]" />
      <aside
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        className="animate-slide-in relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-stone-200 bg-paper shadow-2xl"
      >
        <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-stone-200 bg-paper/95 p-4 backdrop-blur">
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-base font-semibold text-white ${a.bg}`}>{monogram}</span>
          <div className="min-w-0 flex-1">
            <p id="drawer-title" className="truncate font-serif text-lg text-ink">{entry.candidateLabel}</p>
            <p className="truncate text-sm text-steel">
              {enumLabel("archetype", entry.archetype)} · {entry.jobTitle} · <span className="text-ink">{enumLabel("stage", entry.stage)}</span>
            </p>
          </div>
          {entry.matchScore != null ? (
            <span className="rounded-md bg-white px-2 py-1 text-center">
              <span className="block font-serif text-lg leading-none text-ink">{entry.matchScore}</span>
              <span className="text-sm uppercase text-steel">{t("match")}</span>
            </span>
          ) : null}
          <button type="button" onClick={onClose} className="focus-ring rounded-md p-1 text-steel hover:bg-stone-100">
            <X size={18} />
          </button>
        </header>

        <div className="space-y-4 p-4">
          {entry.intakeDegraded ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3">
              <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-red-700">
                <AlertTriangle size={13} /> {t("intakeDegradedTitle")}
              </p>
              <p className="mt-1 text-sm text-ink">
                {t.rich("intakeDegradedBody", { b: (chunks) => <span className="font-semibold">{chunks}</span> })}
              </p>
              {entry.intakeDegradedReason ? (
                <p className="mt-1.5 break-words rounded bg-white/70 px-2 py-1 font-mono text-meta text-steel">
                  {entry.intakeDegradedReason}
                </p>
              ) : null}
              <button
                type="button"
                onClick={resolveIntake}
                disabled={resolvingIntake}
                className="focus-ring mt-2 inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
              >
                <Wrench size={13} /> {resolvingIntake ? t("resolving") : t("markCaptured")}
              </button>
              <p className="mt-1 text-meta text-steel">{t("clearsFlagNote")}</p>
              {intakeErr ? <p role="alert" className="mt-1.5 text-sm text-red-700">{intakeErr}</p> : null}
            </div>
          ) : null}

          {ivOutcome ? (
            <div className="rounded-md border border-moss/40 bg-moss/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-moss">
                  <Phone size={13} /> {t("interviewOutcome")}
                </p>
                {ivOutcome.recommendation ? (
                  <span className={`rounded-full px-2 py-0.5 text-meta font-semibold uppercase ${REC_STYLE[ivOutcome.recommendation] ?? "bg-stone-100 text-steel"}`}>
                    {enumLabel("recommendation", ivOutcome.recommendation)}
                  </span>
                ) : null}
              </div>
              {ivOutcome.summary ? <p className="mt-1 text-sm text-ink">{ivOutcome.summary}</p> : null}
              {ivOutcome.ratings?.length ? (
                <ul className="mt-1.5 space-y-0.5">
                  {ivOutcome.ratings.slice(0, 6).map((r, i) => (
                    <li key={i} className="text-sm text-ink">
                      <span className="font-semibold nums text-coral">{r.rating}/{RATING_MAX}</span> {r.competency}
                    </li>
                  ))}
                </ul>
              ) : null}
              {ivOutcome.ratings?.length ? (
                <p className="mt-1 text-meta text-steel">{t("fixedRubric", { anchor: RUBRIC_ANCHOR_LINE })}</p>
              ) : null}
              <p className="mt-1.5 text-meta text-steel">{t("voiceFeedsNote")}</p>
            </div>
          ) : null}

          {humanSc ? (
            <div className="rounded-md border border-stone-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
                  <ClipboardList size={13} /> {t("humanScorecard")}
                </p>
                {humanSc.recommendation ? (
                  <span className={`rounded-full px-2 py-0.5 text-meta font-semibold uppercase ${REC_STYLE[humanSc.recommendation] ?? "bg-stone-100 text-steel"}`}>
                    {enumLabel("recommendation", humanSc.recommendation)}
                  </span>
                ) : null}
              </div>
              {humanSc.summary ? <p className="mt-1 text-sm text-ink">{humanSc.summary}</p> : null}
              {humanSc.ratings?.length ? (
                <ul className="mt-1.5 space-y-0.5">
                  {humanSc.ratings.slice(0, 8).map((r, i) => (
                    <li key={i} className="text-sm text-ink">
                      <span className="font-semibold nums text-coral">{r.rating}/{RATING_MAX}</span> {r.competency}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-1.5 text-meta text-steel">{t("humanScorecardNote")}</p>
            </div>
          ) : null}

          {/* GH2 — GitHub evidence attached at add-to-pipeline: corroborated vs
              claimed skills beside the interview outcomes, at the surface where
              advance/reject actually happens. */}
          {entry.githubEvidence ? (
            <div className="rounded-md border border-stone-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
                  <GitBranch size={13} /> {t("githubEvidence")}
                </p>
                <a
                  href={entry.githubEvidence.profileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="focus-ring font-mono text-sm text-coral hover:underline"
                >
                  @{entry.githubEvidence.username}
                </a>
              </div>
              {entry.githubEvidence.summary ? (
                <p className="mt-1 text-sm text-ink">{entry.githubEvidence.summary}</p>
              ) : null}
              {entry.githubEvidence.confirmedSkills.length ? (
                <p className="mt-1.5 text-sm text-ink">
                  <span className="font-semibold text-moss">{t("githubEvidenced")}</span>{" "}
                  {entry.githubEvidence.confirmedSkills.join(", ")}
                </p>
              ) : null}
              {entry.githubEvidence.unverifiedClaims.length ? (
                <p className="mt-1 text-sm text-ink">
                  <span className="font-semibold text-amber-700">{t("githubUnverified")}</span>{" "}
                  {entry.githubEvidence.unverifiedClaims.join(", ")}
                </p>
              ) : null}
              {entry.githubEvidence.hiddenStrengths.length ? (
                <p className="mt-1 text-sm text-ink">
                  <span className="font-semibold text-steel">{t("githubHidden")}</span>{" "}
                  {entry.githubEvidence.hiddenStrengths.join(", ")}
                </p>
              ) : null}
              {entry.githubEvidence.topRepositories.length ? (
                <p className="mt-1.5 flex flex-wrap gap-2">
                  {entry.githubEvidence.topRepositories.map((r) => (
                    <a
                      key={r.url}
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="focus-ring inline-flex items-center gap-1 rounded bg-paper px-1.5 py-0.5 font-mono text-sm text-steel hover:text-ink"
                    >
                      <ExternalLink size={11} aria-hidden /> {r.name}
                    </a>
                  ))}
                </p>
              ) : null}
              <p className="mt-1.5 text-meta text-steel">{t("githubEvidenceNote")}</p>
            </div>
          ) : null}

          {/* W6-2 — what this candidate actually received (full letters, not
              just the event line), with failed sends visible at the source. */}
          {comms && comms.length > 0 ? (
            <div>
              <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
                <Mail size={13} /> {t("messages", { count: comms.length })}
              </p>
              <ul className="mt-2 space-y-1">
                {comms.map((m) => (
                  <li key={m.id} className={`rounded-md border px-2.5 py-1 ${m.status === "failed" ? "border-red-200 bg-red-50/50" : "border-stone-100 bg-paper/40"}`}>
                    <details>
                      <summary className="focus-ring flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                        <span className="rounded-full bg-stone-100 px-1.5 py-0.5 text-meta font-semibold uppercase text-steel">
                          {(m.kind ?? "").replace(/_/g, " ")}
                        </span>
                        <span className={`text-meta font-semibold uppercase ${m.status === "failed" ? "text-red-700" : m.status === "sent" ? "text-moss" : "text-steel"}`}>
                          {m.status === "queued" ? (m.channel ?? m.status) : m.status}
                        </span>
                        <span className="ml-auto text-meta text-steel">{relativeTime(m.createdAt)}</span>
                      </summary>
                      <div className="mt-1 border-t border-stone-100 pt-1 text-sm">
                        {m.subject ? <p className="font-semibold text-ink">{m.subject}</p> : null}
                        {m.body ? <pre className="mt-0.5 whitespace-pre-wrap font-sans text-sm leading-5 text-steel">{m.body}</pre> : null}
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {history && history.length > 0 ? (
            <div>
              <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
                <History size={13} /> {t("history")}
              </p>
              <ol className="mt-2 space-y-1.5">
                {history.map((ev) => (
                  <li key={ev.id} className="flex items-start gap-2 text-sm">
                    <span className="mt-0.5">
                      <EventDot kind={ev.kind} />
                    </span>
                    <span className="min-w-0 flex-1 text-ink">{eventVerb(ev)}</span>
                    <span className="shrink-0 text-meta text-steel">{relativeTime(ev.createdAt)}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {entry.status === "active" ? (
            <div>
              <label htmlFor="move-stage" className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
                <ArrowLeftRight size={13} /> {t("moveStage")}
              </label>
              <p className="mt-1 text-sm text-steel">{t("moveStageHelp")}</p>
              <select
                id="move-stage"
                value={entry.stage}
                disabled={movingStage}
                onChange={(e) => moveStage(e.target.value)}
                className="focus-ring mt-2 w-full rounded-md border border-stone-200 bg-white p-2 text-sm font-semibold text-ink disabled:opacity-50"
              >
                {PIPELINE_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {enumLabel("stage", s)}
                    {s === entry.stage ? t("current") : ""}
                  </option>
                ))}
              </select>
              {moveErr ? <p role="alert" className="mt-1.5 text-sm text-red-700">{moveErr}</p> : null}
            </div>
          ) : null}

          <div>
            <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-coral">
              <Sparkles size={13} /> {t("aiActions")}
            </p>
            <p className="mt-1 text-sm text-steel">{t("aiActionsNote")}</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {actions.map((act) => (
                <button
                  key={act.id}
                  type="button"
                  onClick={() => run(act.id)}
                  disabled={busy !== null}
                  className={`focus-ring flex items-center gap-1.5 rounded-md border px-2.5 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
                    result?.task === act.id ? "border-coral bg-coral/5 text-coral" : "border-stone-200 bg-white text-ink hover:border-coral/40"
                  }`}
                >
                  <act.icon size={14} className="shrink-0 text-coral" />
                  {busy === act.id ? t("working") : tActions(act.id)}
                </button>
              ))}
            </div>
          </div>

          {actions.some((act) => act.id === "scorecard") ? (
            <div>
              <label className="text-sm font-semibold uppercase tracking-wide text-steel">{t("notesLabel")}</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder={t("notesPlaceholder")}
                className="focus-ring mt-1 w-full rounded-md border border-stone-200 bg-white p-2 text-sm text-ink"
              />
            </div>
          ) : null}

          {showLinks ? (
            <div className="rounded-md border border-stone-200 bg-white p-3">
              <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-coral">
                <Phone size={13} /> {t("voiceScreen")}
              </p>
              <p className="mt-1 text-sm text-steel">{t("voiceScreenHelp")}</p>
              <div className="mt-2 inline-flex rounded-md border border-stone-200 bg-paper p-0.5">
                {(["openai", "elevenlabs"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    disabled={voice.busy}
                    aria-pressed={voiceProvider === p}
                    onClick={() => setVoiceProvider(p)}
                    className={`focus-ring rounded px-2.5 py-1 text-sm font-medium transition-colors ${
                      voiceProvider === p ? "bg-white text-ink shadow-panel" : "text-steel hover:text-ink"
                    }`}
                  >
                    {p === "openai" ? "OpenAI" : "ElevenLabs"}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => voice.create({ entryId: entry.id, provider: voiceProvider })}
                disabled={voice.busy}
                className="focus-ring ml-2 inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-ink hover:border-coral/40 disabled:opacity-50"
              >
                <Phone size={13} className="text-coral" /> {voice.busy ? t("creating") : t("createLink")}
              </button>

              {voice.err ? <p role="alert" className="mt-2 text-sm text-red-700">{voice.err}</p> : null}

              {voice.data ? (
                <div className="mt-2 space-y-1.5">
                  <TokenLinkPanel link={voice} />
                  {Boolean(voice.data.configured) && Boolean(voice.data.delivered) ? (
                    <p className="text-sm text-moss">{t("inviteSent")}</p>
                  ) : null}
                  {Boolean(voice.data.configured) && !voice.data.delivered ? (
                    <p className="text-sm text-amber-700">{t("inviteNotSent")}</p>
                  ) : null}
                  {Number(voice.data.revoked ?? 0) > 0 ? (
                    <p className="text-sm text-steel">{t("priorLinksRevoked", { count: Number(voice.data.revoked) })}</p>
                  ) : null}
                  {!voice.data.configured ? (
                    <p className="text-sm text-coral">
                      {t("notConfigured", {
                        vars: voiceProvider === "openai" ? "OPENAI_API_KEY" : "ELEVENLABS_API_KEY + ELEVENLABS_AGENT_ID",
                      })}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {/* W6-4 — pull every live link for this candidate without minting
                  a replacement (wrong candidate, shared too widely, changed mind). */}
              <button
                type="button"
                onClick={async () => {
                  setRevokeNote(null);
                  try {
                    const r = await fetch("/api/interview/revoke", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ entryId: entry.id }),
                    });
                    const p = (await r.json().catch(() => null)) as { revoked?: number } | null;
                    if (!r.ok) throw new Error();
                    setRevokeNote(t("linksRevoked", { count: p?.revoked ?? 0 }));
                  } catch {
                    setRevokeNote(t("revokeFailed"));
                  }
                }}
                className="focus-ring mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm text-steel hover:text-coral"
              >
                <Ban size={12} aria-hidden /> {t("revokeLinks")}
              </button>
              {revokeNote ? <p className="text-sm text-steel">{revokeNote}</p> : null}
            </div>
          ) : null}

          {showLinks ? (
            <div className="rounded-md border border-stone-200 bg-white p-3">
              <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-coral">
                <Calendar size={13} /> {t("selfScheduling")}
              </p>
              <p className="mt-1 text-sm text-steel">{t("selfSchedulingHelp")}</p>
              <button
                type="button"
                onClick={() => sched.create({ entryId: entry.id })}
                disabled={sched.busy}
                className="focus-ring mt-2 inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-ink hover:border-coral/40 disabled:opacity-50"
              >
                <Calendar size={13} className="text-coral" /> {sched.busy ? t("creating") : t("createSchedulingLink")}
              </button>
              {sched.err ? <p role="alert" className="mt-2 text-sm text-red-700">{sched.err}</p> : null}
              {sched.data ? (
                <div className="mt-2">
                  <TokenLinkPanel link={sched} />
                </div>
              ) : null}
            </div>
          ) : null}

          {error ? <p role="alert" className="rounded-md bg-red-50 p-2.5 text-sm text-red-700">{error}</p> : null}

          {result ? <ResultView result={result} /> : null}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <button
              type="button"
              onClick={() => {
                if (entry.candidateId) router.push(buildUrl({ tab: "match", profile: entry.candidateId }, search.toString()));
              }}
              className="focus-ring inline-flex items-center gap-1 text-sm font-semibold text-steel hover:text-coral"
            >
              <ExternalLink size={13} /> {t("openFullMatch")}
            </button>
            {entry.candidateId ? (
              <button
                type="button"
                onClick={() => router.push(buildUrl({ tab: "profile", edit: entry.candidateId as string }, search.toString()))}
                className="focus-ring inline-flex items-center gap-1 text-sm font-semibold text-steel hover:text-coral"
              >
                <Pencil size={13} /> {t("editProfile")}
              </button>
            ) : null}
          </div>
        </div>
      </aside>
    </div>
  );
}
