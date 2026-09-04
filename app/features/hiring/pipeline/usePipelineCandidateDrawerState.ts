"use client";

// All of CandidateDrawer's state, effects and handlers: the one-call bundle
// load (history/comms/interview/consent/notes), the automation-task run +
// completion consumption, stage move, intake recovery, on-demand GitHub
// deep-dive, and the debounced/flushed candidate note. Split out of the .tsx
// so the component file is wiring + markup; this hook owns no JSX.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useDialogA11y } from "@/app/_components/useDialogA11y";
import type { CandidateComm, CandidateConsentView, CandidateTimelineItem, RematchLink } from "@/app/_lib/candidate-timeline";
import type { InterviewTelemetry } from "@/app/_lib/interview-telemetry";
import type { ScorecardCoverage } from "@/app/_lib/interview-transcript";
import { useTasks, useTaskResult } from "@/app/features/shell/tasks/TasksProvider";
import { toast } from "@/app/_components/toast-store";
import { useTokenLink } from "./PipelineTokenLink";
import { scorecardTaskNotes, type Entry, type Result, type TaskId } from "./PipelineCandidateDrawerTypes";
import { type Entry as BoardEntry, type PipelineEvent } from "@/app/features/shared/pipelineTypes";
import { buildGithubEvidenceSummary, type GithubEvidenceSummary } from "@/app/_lib/github-summary";
import { githubAnalysisSchema } from "@/app/_lib/schemas";
import type { Scorecard, ScorecardRating, ScorecardEntities } from "@/app/_lib/interview-scorecard";
import { postPipelineAction } from "@/app/_lib/useAddToPipeline";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { noteUnmountAction, resolveNoteSave, shouldHydrateNote } from "./pipelineDrawerNote";
import { useGithubErrorMessage } from "@/app/_lib/use-github-error";

export type InterviewOutcome = {
  recommendation?: string;
  summary?: string;
  ratings?: ScorecardRating[];
  hasTranscript?: boolean;
  // Round-3 conversation signals + scoring-coverage caveat, projected server-side
  // onto the bundle (candidate-timeline.ts) — rendered with the same semantics as
  // the InterviewTranscriptModal strip. Absent ⇒ no chrome.
  telemetry?: InterviewTelemetry;
  coverage?: ScorecardCoverage;
  // Structured read-back outcome (scorecard-v5), projected server-side onto the
  // bundle — confirmed / corrected (heard→meant) / unconfirmed technologies. Absent
  // ⇒ no read-back ⇒ no chrome, same rule as telemetry/coverage.
  entities?: ScorecardEntities;
};

// Client-side cap for the persistent candidate note — mirrors MAX_NOTES_LENGTH
// on /api/pipeline/[id] so the textarea can never assemble a note the route rejects.
const NOTE_MAX = 4000;

export function usePipelineCandidateDrawerState({
  entry,
  onClose,
  onChanged,
  onOpenEntry,
  cohort,
}: {
  entry: Entry;
  onClose: () => void;
  onChanged: () => void;
  onOpenEntry?: (entryId: string) => void;
  cohort?: BoardEntry[];
}) {
  const t = useTranslations("pipeline.drawer");
  // API failures resolve from the machine `code`, never the server's English
  // `error` — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  // The GitHub deep-dive answers with its own code namespace (results.github.errors).
  const ghErrMsg = useGithubErrorMessage();
  const { startTask } = useTasks();
  const [busy, setBusy] = useState<TaskId | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The task runner's own stored diagnostic for a failed/interrupted run. It is the
  // runner's ENGLISH prose (a Python traceback tail, a provider message) with no code
  // to resolve, so it is never the sentence the recruiter reads — it rides the error
  // line as a `title` for whoever is debugging. See the note at the render-phase
  // consumption below.
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

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
  // "View transcript, without leaving the drawer": when the interview chapter
  // reports hasTranscript, open the existing InterviewTranscriptModal in place
  // (stacked over the drawer). Absent transcript ⇒ this stays false and no chrome
  // renders.
  const [showTranscript, setShowTranscript] = useState(false);
  // The recruiter's human scorecard for this candidate (PREP1), if one was filled
  // from the prep modal — surfaced here so a human-led round isn't invisible on
  // the board the way the AI voice-screen scorecard already is.
  const [humanSc, setHumanSc] = useState<Scorecard | null>(null);

  // Per-candidate history (PIPE3): the entry's events oldest→newest — applied →
  // screened → advanced → scheduled → moved → … — so a recruiter opening a
  // candidate sees the story of how they got here, not just the latest state.
  const [history, setHistory] = useState<PipelineEvent[] | null>(null);
  // single-entry-authz-parity: the /api/pipeline/[id] surfaces are operator-gated now,
  // so a demo/non-operator session gets a 401/403. Surface an honest, localized line
  // instead of a blank drawer (timeline) or the server's raw "Unauthorized" (actions).
  const [timelineErr, setTimelineErr] = useState<string | null>(null);
  // c6524f2f — the rest of the candidate's story: analyses, interview, invites,
  // offer, joined server-side and merged chronologically into the history below.
  // Comms are excluded here — the drawer has a richer dedicated section above.
  const [extraTimeline, setExtraTimeline] = useState<CandidateTimelineItem[]>([]);
  // rematch-story-navigable — the resolved counterpart of each re-engagement event,
  // keyed by event id (server-side existence check), so the history can render a
  // navigable link only when the other entry still exists in this workspace.
  const [rematchLinks, setRematchLinks] = useState<Record<number, RematchLink>>({});
  // drawer-staleness-parity — the JD's last content-edit instant when this entry's
  // score predates it (server-derived in the bundle, same isScoreStale rule Decisions
  // uses). Null ⇒ fresh / unscored / snapshot / corpus — no chip.
  const [staleSince, setStaleSince] = useState<string | null>(null);
  // GDPR consent snapshot + audit trail, now IN the bundle so ConsentPanel reads it
  // from props instead of firing its own second fetch (one-call drawer).
  const [consent, setConsent] = useState<CandidateConsentView | null>(null);
  // drawer-comms-truth — did the bundle load FAIL (network throw, or a non-OK
  // response)? `consent` is initialized null — deliberately, because that is what stops
  // ConsentPanel firing its own second fetch — so null alone cannot distinguish "still
  // loading" from "gave up", and the GDPR panel rendered a permanent "loading…". This
  // flag is the missing third state; it is passed to the panel, never used to re-fetch.
  const [bundleFailed, setBundleFailed] = useState(false);

  // WCAG dialog behavior via the shared hook (replacing a hand-rolled, node-bound
  // version whose Escape only fired while focus was inside the drawer and which didn't
  // join the modal stack): focus-in, Tab-trap, Escape (top-of-stack gated), scroll-lock,
  // and focus restore. aria-modal="true" + the dimming backdrop below make this modal.
  const dialogRef = useRef<HTMLElement | null>(null);
  useDialogA11y(dialogRef, onClose, { trap: true, lockScroll: true });

  // W6-4 — outcome note for the revoke-links action: pull every live link for
  // this candidate without minting a replacement (wrong candidate, shared too
  // widely, changed mind).
  const [revokeNote, setRevokeNote] = useState<string | null>(null);
  const revokeLinks = async () => {
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
  };

  // W6-2 (SIM1) — the actual letters this candidate received (events say
  // "rejection_sent"; this shows the rejection). Best-effort, hides when empty.
  // failure-truth-everywhere: the bundle now carries the DERIVED delivery verdict
  // (server-side, from the same comms-view derivation the Comms Center reads) instead
  // of only the raw `status` column — which is why a bounced offer used to render a
  // green "sent" here while Channels showed it red.
  const [comms, setComms] = useState<CandidateComm[] | null>(null);

  // drawer-note-fresh-hydration — the recruiter note as it stands ON THE SERVER,
  // carried on the one-call bundle. The board prop (entry.notes) that seeds candNote
  // at mount can be STALE: set_notes writes only `notes` + `updated_at`, neither of
  // which is in entrySignature (render-diet doctrine covers exactly what a board CARD
  // shows, not the note), so the board's close-refresh sees an identical signature and
  // keeps the pre-edit prop — a just-saved note then reverts on reopen. This holds the
  // server truth; the reconcile effect below hydrates candNote from it. Null until the
  // bundle lands.
  const [bundleNotes, setBundleNotes] = useState<string | null>(null);

  // One-call drawer load (perfect-board): the entry's WHOLE story in a SINGLE
  // request to the enriched /timeline endpoint — pipeline events, the cross-store
  // timeline items, the full comms letters, the latest interview outcome and the
  // human scorecard. This replaces the FIVE independent fetches this drawer used
  // to fire on open (interview by-entry, interview-prep, comms, events, timeline),
  // cutting drawer-open to one round trip and one server pass. Best-effort: a
  // failed load leaves the sections empty; the drawer's actions don't depend on it.
  useEffect(() => {
    let alive = true;
    fetch(`/api/pipeline/${encodeURIComponent(entry.id)}/timeline`)
      .then((r) => {
        // Don't leave the timeline silently blank on a permission refusal — the whole
        // bundle (history, comms, interview, scorecard) is gated together, so name it;
        // any other response clears a stale refusal. Set inside the async callback (not
        // synchronously in the effect body) so it lands after render, not during it.
        if (alive) setTimelineErr(r.status === 401 || r.status === 403 ? t("notPermitted") : null);
        return r.ok ? r.json() : null;
      })
      .then((d) => {
        if (!alive) return;
        if (!d) {
          // A non-OK response (401/403/5xx): the WHOLE bundle is gone, consent included.
          setHistory([]);
          setBundleFailed(true);
          return;
        }
        setBundleFailed(false);
        setHistory((d.events as PipelineEvent[]) ?? []);
        // drawer-note-fresh-hydration — the recruiter note rides the bundle as SERVER
        // TRUTH. Stash it in state here (no ref touched during the fetch effect); a
        // dedicated effect below reconciles it into candNote once the note refs exist.
        setBundleNotes((d.notes as string | null | undefined) ?? "");
        setExtraTimeline((d.items as CandidateTimelineItem[]) ?? []);
        setRematchLinks((d.rematchLinks as Record<number, RematchLink> | undefined) ?? {});
        setStaleSince((d.staleSince as string | null | undefined) ?? null);
        setComms((d.comms as typeof comms) ?? []);
        setIvOutcome((d.interview as InterviewOutcome | null) ?? null);
        setConsent((d.consent as CandidateConsentView | undefined) ?? null);
        // Same client-side gate the dedicated prep fetch used: keep a scorecard
        // only when it carries ratings or a summary (an empty artifact is noise).
        const sc = (d.humanScorecard as Scorecard | null) ?? null;
        setHumanSc(sc && (sc.ratings?.length || sc.summary) ? sc : null);
      })
      .catch(() => {
        if (!alive) return;
        setHistory([]);
        // The path the consent panel used to hang on: only `history` was reset here, so
        // `consent` stayed null and read as "still loading" forever.
        setBundleFailed(true);
      });
    return () => {
      alive = false;
    };
    // entry.stage rides the deps so an IN-PLACE stage move (drawer-flow-friction —
    // same id, new stage, no remount) re-pulls the bundle: the new move event lands in
    // the history and staleSince is recomputed. A neighbor swap changes entry.id.
    // `t` is a stable next-intl binding (per namespace/locale) — listed for the lint
    // rule; it can't churn the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id, entry.stage, t]);

  // The unified story: pipeline events + the cross-store chapters, time-ordered.
  const mergedHistory = useMemo(() => {
    type Row =
      | { at: string; key: string; type: "event"; ev: PipelineEvent }
      | { at: string; key: string; type: "extra"; item: CandidateTimelineItem };
    const rows: Row[] = [
      ...(history ?? []).map((ev) => ({ at: ev.createdAt, key: `ev-${ev.id}`, type: "event" as const, ev })),
      ...extraTimeline.map((item, i) => ({ at: item.at, key: `tl-${i}`, type: "extra" as const, item })),
    ];
    rows.sort((a, b) => a.at.localeCompare(b.at));
    return rows;
  }, [history, extraTimeline]);

  // drawer-flow-friction — prev/next WITHIN the board's currently-filtered cohort
  // (derived from the passed list, no store). Present only when this entry is IN the
  // cohort and there's more than one to walk; a counterpart opened off-board (rematch
  // link, terminal entry) simply isn't in the cohort, so the nav hides for it.
  const cohortIndex = cohort ? cohort.findIndex((e) => e.id === entry.id) : -1;
  const prevEntry = cohort && cohortIndex > 0 ? cohort[cohortIndex - 1] : null;
  const nextEntry = cohort && cohortIndex >= 0 && cohortIndex < cohort.length - 1 ? cohort[cohortIndex + 1] : null;

  // Run through the background-task system: the work survives closing the drawer
  // or navigating away, and a duplicate click reuses the in-flight task (dedup).
  const run = async (task: TaskId, candNote: string) => {
    setBusy(task);
    setError(null);
    setErrorDetail(null);
    setResult(null);
    setPendingId(null);
    const started = await startTask("automation", {
      entryId: entry.id,
      task,
      // note-truth-unification — the scorecard synthesis consumes the CURRENT
      // persistent candidate note (candNote, incl. unsaved edits), not a stale
      // transient copy. Every other task sends none (scorecardTaskNotes).
      notes: scorecardTaskNotes(task, candNote),
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
      if (res.status === 401 || res.status === 403) {
        setIntakeErr(t("notPermitted"));
        setResolvingIntake(false);
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(errMsg(data, t("clearFlagFailed")));
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
  // concurrent change. drawer-flow-friction: a stage move CORRECTS a miscategorization
  // — it doesn't remove the candidate from the board — so on success the board reloads
  // behind the drawer AND the drawer refreshes IN PLACE (onOpenEntry re-reads the same
  // id → the id-keyed drawer re-renders without remounting), instead of ejecting the
  // recruiter from the candidate they were reading. Only genuinely terminal actions
  // (resolve_intake, which drops the entry from its degraded cohort) still close.
  const moveStage = async (toStage: string) => {
    if (toStage === entry.stage || movingStage) return;
    setMovingStage(true);
    setMoveErr(null);
    try {
      const res = await postPipelineAction(entry.id, { action: "set_stage", toStage, expectedStage: entry.stage });
      // A gated deploy refuses a non-operator here (single-entry-authz-parity) — show
      // the localized permission line, not the server's raw "Unauthorized".
      if (res.status === 401 || res.status === 403) throw new Error(t("notPermitted"));
      const data = await res.json();
      if (!res.ok) throw new Error(errMsg(data, t("moveFailed")));
      onChanged();
      if (onOpenEntry) onOpenEntry(entry.id);
      else onClose();
      setMovingStage(false);
    } catch (caught) {
      // Surface the server's own explanation (the 422 "route through Offer →
      // extend an offer" guidance, the 409 "changed since you opened it" hint)
      // rather than the blanket moveFailed that hid the one sentence telling the
      // recruiter what to do instead (bug-ui pipeline #2) — resolved from the
      // machine `code` so it arrives in the reader's language, never as the
      // server's English `error`. A network throw with no message falls back to
      // the generic copy.
      setMoveErr(caught instanceof Error && caught.message ? caught.message : t("moveFailed"));
      setMovingStage(false);
    }
  };

  // On-demand GitHub deep-dive for an inbound applicant who shared a handle at
  // apply but has no evidence attached yet (the recruiter-side add is the only
  // other writer). Runs the same /api/github-analysis the report surface uses
  // (the route returns 200 + {error} for soft failures like rate limits),
  // compacts the result via the single shape authority, and persists it through
  // the entry's set_github action so the next board load carries it.
  const [ghBusy, setGhBusy] = useState(false);
  const [ghErr, setGhErr] = useState<string | null>(null);
  const [ghRun, setGhRun] = useState<GithubEvidenceSummary | null>(null);
  // The drawer's view of the evidence: what the entry carried, else what this
  // session's run just attached (the entry prop is frozen until the board reloads).
  const github = entry.githubEvidence ?? ghRun;
  const runGithubDeepDive = async () => {
    if (!entry.githubHandle || ghBusy) return;
    setGhBusy(true);
    setGhErr(null);
    try {
      const res = await fetch("/api/github-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // No cheap JD-text source exists here (the board payload carries no
        // description) — pass empty string, the same contract SubmissionRow's
        // assessAuthor uses; jobFitSignals then honestly report "no JD provided".
        body: JSON.stringify({ profile: entry.githubHandle, jobDescriptionText: "" }),
      });
      const payload = await res.json();
      // The route returns 200 + {error, code} for soft failures (rate limits), so the
      // presence of `error` — not the HTTP status — is the failure discriminator. The
      // cause still reaches the recruiter, now from the `code` and in their language.
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
      onChanged(); // the entry now carries evidence — reload the board behind the drawer
    } catch (caught) {
      setGhErr(caught instanceof Error && caught.message ? caught.message : t("githubRunFailed"));
    } finally {
      setGhBusy(false);
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
  // OO-L2-12 — one-shot trigger for the give-up toast below: bumped in the
  // render-phase branch (own state, legal there), consumed by an effect (the
  // toast store is external state, so it must not be poked during render).
  const [resultLostCount, setResultLostCount] = useState(0);
  const { status: actionStatus, error: actionError, full: actionFull, resultUnavailable } = useTaskResult(pendingId);
  if (pendingId && actionStatus === "succeeded" && actionFull) {
    const data = actionFull.result as { result: Record<string, unknown>; source: string; applied: string } | null;
    const sub = (((actionFull.params as { task?: string } | null)?.task ?? busy) ?? "screen") as TaskId;
    if (data) {
      setResult({ task: sub, data: data.result, source: data.source, applied: data.applied });
    }
    setBusy(null);
    setPendingId(null);
  } else if (pendingId && (actionStatus === "failed" || actionStatus === "canceled" || actionStatus === "interrupted")) {
    // The runner's diagnostic is NOT a client-safe, localizable answer: it has no code
    // (useTaskResult passes `polled.error` through unchanged) and it is written in
    // English by the queue. Coalescing it OVER the localized line — `actionError ??
    // t("taskIncomplete")` — meant a failed run painted the runner's English onto a
    // Czech, German or French drawer whenever a diagnostic existed, i.e. in the common
    // case. The localized line is now what renders; the diagnostic is carried as
    // details (a `title` on the error paragraph). The runner GAINING a code is the
    // tasks context's follow-up — it is the only place that can mint one.
    setError(t("taskIncomplete"));
    setErrorDetail(actionError);
    setBusy(null);
    setPendingId(null);
  } else if (pendingId && resultUnavailable) {
    // OO-L2-12 — the task finished server-side but its result record can't be
    // fetched (useTaskResult gave up after RESULT_FETCH_MAX_ATTEMPTS). Without
    // this the drawer spun "Working…" forever with no error and no way out.
    // Resolve the busy state and surface the inline error; the action button
    // unlocking again is the retry affordance.
    setError(t("resultLoadFailed"));
    setErrorDetail(null);
    setBusy(null);
    setPendingId(null);
    setResultLostCount((n) => n + 1);
  }

  // Post-commit parent notification: an applied action changed the entry, so the
  // board behind the drawer must reload. Keyed on the consumed result object (a
  // fresh object per completion → fires once per applied task); reads onChanged
  // through the latest-ref so a parent re-render can't re-trigger a reload.
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  });
  // OO-L2-12 — post-commit toast for the result-lost path (the toast store is
  // an external system, so it's updated from an effect, keyed on the one-shot
  // counter; `t` through the latest-ref so a locale swap can't re-fire it).
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  });
  useEffect(() => {
    if (resultLostCount > 0) toast.error(tRef.current("resultLoadFailed"));
  }, [resultLostCount]);
  const appliedResult =
    result && ["advanced", "held_for_review", "scorecard_ready", "offer_ready", "rematched"].includes(result.applied)
      ? result
      : null;
  useEffect(() => {
    if (appliedResult) onChangedRef.current();
  }, [appliedResult]);

  // Persistent per-candidate note: the call facts ("wants 80k, available August,
  // hybrid") that used to die with the drawer live on the entry now. Hydrated
  // from the entry at mount (the drawer remounts per candidate — keyed by id),
  // then debounce-autosaved through the set_notes action — the PREP2
  // prep-progress pattern. The dirty ref gates saves to genuine user edits so
  // hydration doesn't echo back. Capped to the route's bound via maxLength.
  const [candNote, setCandNote] = useState(entry.notes ?? "");
  const [noteStatus, setNoteStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const noteDirtyRef = useRef(false);
  // True once a note save has SUCCEEDED this session (bug-ui pipeline #5). The
  // board's copy of entry.notes is now stale, so the board is refreshed exactly
  // ONCE on drawer close (below) — not on every debounced autosave, which used to
  // refetch the whole board behind the still-open drawer and defeat the deliberate
  // 30s-poll pause the open drawer is meant to hold.
  const noteSavedRef = useRef(false);
  // Keep the freshest note in a ref so the unmount flush sends it. Declared BEFORE
  // the debounce effect that reads it — React Compiler treats a ref captured ahead
  // of its declaration as an immutable value and rejects the later mirror write.
  const latestNoteRef = useRef(candNote);
  useEffect(() => {
    latestNoteRef.current = candNote;
  }, [candNote]);
  useEffect(() => {
    if (!noteDirtyRef.current) return;
    const value = candNote; // the exact content this debounced save will persist
    const h = window.setTimeout(() => {
      void fetch(`/api/pipeline/${encodeURIComponent(entry.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_notes", notes: value }),
      })
        .then((r) => {
          // The note's bookkeeping is ONE pure decision (pipelineDrawerNote.ts, pinned
          // by pipelineDrawerNote.test.ts): a success clears the dirty flag ONLY when
          // nothing newer was typed while the save was in flight, and any landed save
          // means the board's copy is stale and owes the single close-time refresh.
          const res = resolveNoteSave({
            ok: r.ok,
            savedValue: value,
            latestValue: latestNoteRef.current,
            savedThisSession: noteSavedRef.current,
          });
          noteSavedRef.current = res.savedThisSession;
          if (res.clearDirty) noteDirtyRef.current = false;
          setNoteStatus(res.status);
        })
        .catch(() => setNoteStatus("error"));
    }, 600);
    return () => window.clearTimeout(h);
  }, [candNote, entry.id]);

  // drawer-note-fresh-hydration — reconcile candNote with the SERVER-truth note that
  // rode the bundle. The rule: overwrite candNote from the bundle ONLY when the user
  // hasn't edited in THIS open (noteDirtyRef still clean). That heals the stale-prop
  // seed (a note saved in a prior open, close→reopen, whose board prop never refreshed
  // because notes aren't in entrySignature) without ever clobbering in-progress typing —
  // so an in-place re-pull (a stage move) or the 30s poll can't wipe an unsaved edit.
  // Reading noteDirtyRef here (after its declaration, like the unmount flush) — never in
  // the fetch effect above — keeps the immutability rule satisfied.
  useEffect(() => {
    if (shouldHydrateNote(bundleNotes, noteDirtyRef.current)) setCandNote(bundleNotes as string);
  }, [bundleNotes]);

  // Flush a pending edit on unmount (drawer close). The debounce effect's
  // cleanup cancels an in-flight 600ms timer, so closing right after typing the
  // last call fact — the common case — would otherwise drop it. keepalive lets
  // the request survive the unmount/navigation.
  useEffect(() => {
    return () => {
      const owed = noteUnmountAction({ dirty: noteDirtyRef.current, savedThisSession: noteSavedRef.current });
      if (owed === "flush") {
        // A genuinely-unsaved trailing edit — the debounce timer was cancelled by
        // this unmount. Flush it with keepalive, then refresh the board ONCE the
        // write lands so reopening the candidate hydrates the note, not a stale blank.
        void fetch(`/api/pipeline/${encodeURIComponent(entry.id)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "set_notes", notes: latestNoteRef.current }),
          keepalive: true,
        })
          .then((r) => {
            if (r.ok) onChangedRef.current();
          })
          .catch(() => {
            /* note save is best-effort — the debounced write already ran for all but the last pause */
          });
      } else if (owed === "refresh") {
        // Nothing left to flush (the debounce already saved and cleared the dirty
        // flag), but a save DID land this session, so the board's entry.notes is
        // stale — do the single deferred board refresh now, on close, instead of on
        // every autosave (bug-ui pipeline #5).
        onChangedRef.current();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id]);

  return {
    dialogRef,
    busy, error, errorDetail, result,
    voiceProvider, setVoiceProvider, voice, sched,
    resolvingIntake, intakeErr, resolveIntake,
    movingStage, moveErr, moveStage,
    ivOutcome, showTranscript, setShowTranscript,
    humanSc,
    timelineErr, mergedHistory, rematchLinks,
    staleSince, consent, bundleFailed,
    revokeNote, setRevokeNote, revokeLinks,
    comms,
    cohortIndex, prevEntry, nextEntry,
    run,
    ghBusy, ghErr, github, runGithubDeepDive,
    showLinks,
    candNote, setCandNote, noteStatus,
    noteDirtyRef,
    NOTE_MAX,
  };
}
