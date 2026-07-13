"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeftRight, Ban, Banknote, Calendar, ClipboardList, ExternalLink, FileText, GitBranch, History, Mail, NotebookPen, Pencil, Phone, Shuffle, Sparkles, UserCheck, Wrench, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDialogA11y } from "@/app/_components/useDialogA11y";
import { useScoreProvenanceText } from "@/app/_components/ScoreProvenanceLabel";
import type { CandidateTimelineItem } from "@/app/_lib/candidate-timeline";
import { buildUrl } from "@/app/features/tabs";
import { useTasks, useTaskResult } from "@/app/features/tasks/TasksProvider";
import { useDeliveryCapability } from "@/app/features/useDeliveryCapability";
import { toast } from "@/app/_components/toast-store";
import { Select } from "@/app/_components/Select";
import { TextArea } from "@/app/_components/TextArea";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { ResultView } from "./CandidateResultView";
import { ConsentPanel } from "./ConsentPanel";
import { useTokenLink, TokenLinkPanel } from "./TokenLink";
import { type Entry, type Result, type TaskId } from "./CandidateDrawerTypes";
import { styleFor, type PipelineEvent } from "./PipelineTypes";
import { EventDot, useEventVerb, useRelativeTime } from "./PipelineShared";
import { moveStageSelectValues } from "./pipeline-move-targets";
import { SCREENING_STAGES } from "@/app/_lib/pipeline-stages";
import { RUBRIC_ANCHOR_LINE } from "@/app/_lib/interview-rubric";
import { RATING_MAX } from "@/app/_lib/format";
import type { Scorecard, ScorecardRating } from "@/app/_lib/interview-scorecard";
import { buildGithubEvidenceSummary, type GithubEvidenceSummary } from "@/app/_lib/github-summary";
import { githubAnalysisSchema } from "@/app/_lib/schemas";
import { initials } from "@/app/_lib/initials";
import { canonicalScoreOf, provenanceOf } from "@/app/_lib/match-score";
import { postPipelineAction } from "@/app/_lib/useAddToPipeline";

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

// Client-side cap for the persistent candidate note — mirrors MAX_NOTES_LENGTH
// on /api/pipeline/[id] so the textarea can never assemble a note the route rejects.
const NOTE_MAX = 4000;

// REC-10 — the truthful delivery claim from a token-link POST response. The
// invite routes now return `delivery` (sent = relayed 2xx · queued = local
// outbox row, nothing will deliver it · failed = dead-lettered/threw); an older
// response shape without it degrades through the legacy boolean, where `true`
// only ever meant "an outbox row was recorded" — shown as queued, never as a
// false green "sent".
function deliveryClaimOf(data: Record<string, unknown>, legacyFlag: "delivered" | "dispatched"): "sent" | "queued" | "failed" {
  const d = data.delivery;
  if (d === "sent" || d === "queued" || d === "failed") return d;
  return data[legacyFlag] ? "queued" : "failed";
}

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
  // d95fed6d — origin-chip labels reuse the channel-name catalog Analytics
  // already maintains, falling back to the raw id for unmapped values.
  const tChannels = useTranslations("analytics.channels");
  const channelName = (channel: string) => {
    const key = `names.${channel}` as Parameters<typeof tChannels>[0];
    return tChannels.has(key) ? tChannels(key) : channel;
  };
  const enumLabel = useEnumLabel();
  const eventVerb = useEventVerb();
  const relativeTime = useRelativeTime();
  // Canonical match-score provenance label (REC-01), shared wording with the
  // board tooltip and the decisions queue.
  const provenanceText = useScoreProvenanceText();
  const { startTask } = useTasks();
  const [busy, setBusy] = useState<TaskId | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  // Transient fuel for the scorecard task — pre-filled from the persisted
  // per-candidate note (below) so the AI synthesis starts from the call facts
  // already captured, not a blank box. Edits here stay local to the task run.
  const [notes, setNotes] = useState(entry.notes ?? "");
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
  // c6524f2f — the rest of the candidate's story: analyses, interview, invites,
  // offer, joined server-side and merged chronologically into the history below.
  // Comms are excluded here — the drawer has a richer dedicated section above.
  const [extraTimeline, setExtraTimeline] = useState<CandidateTimelineItem[]>([]);

  // WCAG dialog behavior via the shared hook (replacing a hand-rolled, node-bound
  // version whose Escape only fired while focus was inside the drawer and which didn't
  // join the modal stack): focus-in, Tab-trap, Escape (top-of-stack gated), scroll-lock,
  // and focus restore. aria-modal="true" + the dimming backdrop below make this modal.
  const dialogRef = useRef<HTMLElement | null>(null);
  useDialogA11y(dialogRef, onClose, { trap: true, lockScroll: true });

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
    fetch(`/api/pipeline/${encodeURIComponent(entry.id)}/timeline`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d) {
          setExtraTimeline(((d.items as CandidateTimelineItem[]) ?? []).filter((i) => i.kind !== "comm"));
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [entry.id]);

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
      const res = await postPipelineAction(entry.id, { action: "set_stage", toStage, expectedStage: entry.stage });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Move failed (${res.status})`);
      onChanged();
      onClose();
    } catch (caught) {
      // Surface the server's own explanation verbatim (the 422 "route through
      // Offer → extend an offer" guidance, the 409 "changed since you opened it"
      // hint) rather than the blanket moveFailed that hid the one sentence telling
      // the recruiter what to do instead (bug-ui pipeline #2). A network throw with
      // no message falls back to the generic copy.
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
      // The route returns 200 + {error} for soft failures (rate limits) — that
      // message names the actual cause, so surface it verbatim.
      if (payload && typeof payload === "object" && typeof payload.error === "string") {
        throw new Error(payload.error);
      }
      const parsed = githubAnalysisSchema.safeParse(payload);
      if (!res.ok || !parsed.success) throw new Error(t("githubRunFailed"));
      const summary = buildGithubEvidenceSummary(parsed.data);
      const save = await fetch(`/api/pipeline/${encodeURIComponent(entry.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_github", github: summary }),
      });
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
    setError(actionError ?? t("taskIncomplete"));
    setBusy(null);
    setPendingId(null);
  } else if (pendingId && resultUnavailable) {
    // OO-L2-12 — the task finished server-side but its result record can't be
    // fetched (useTaskResult gave up after RESULT_FETCH_MAX_ATTEMPTS). Without
    // this the drawer spun "Working…" forever with no error and no way out.
    // Resolve the busy state and surface the inline error; the action button
    // unlocking again is the retry affordance.
    setError(t("resultLoadFailed"));
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
          if (r.ok) {
            noteSavedRef.current = true;
            // Clear the dirty flag so the unmount flush only re-POSTs a GENUINELY
            // unsaved trailing edit — previously it was never reset, so every close
            // after any edit fired a redundant second save. Only clear it when
            // nothing newer was typed while this save was in flight (else the newer
            // keystroke's own debounce / the unmount flush must still persist it).
            if (latestNoteRef.current === value) noteDirtyRef.current = false;
            setNoteStatus("saved");
          } else {
            setNoteStatus("error");
          }
        })
        .catch(() => setNoteStatus("error"));
    }, 600);
    return () => window.clearTimeout(h);
  }, [candNote, entry.id]);

  // Keep the freshest note in a ref so the unmount flush sends it.
  const latestNoteRef = useRef(candNote);
  useEffect(() => {
    latestNoteRef.current = candNote;
  }, [candNote]);

  // Flush a pending edit on unmount (drawer close). The debounce effect's
  // cleanup cancels an in-flight 600ms timer, so closing right after typing the
  // last call fact — the common case — would otherwise drop it. keepalive lets
  // the request survive the unmount/navigation.
  useEffect(() => {
    return () => {
      if (noteDirtyRef.current) {
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
      } else if (noteSavedRef.current) {
        // Nothing left to flush (the debounce already saved and cleared the dirty
        // flag), but a save DID land this session, so the board's entry.notes is
        // stale — do the single deferred board refresh now, on close, instead of on
        // every autosave (bug-ui pipeline #5).
        onChangedRef.current();
      }
    };
  }, [entry.id]);

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
              {/* d95fed6d — provenance: which surface/channel filed this person. */}
              {entry.sourceChannel ? <> · {t("via", { channel: channelName(entry.sourceChannel) })}</> : null}
            </p>
          </div>
          {/* Canonical match score (REC-01 / OO-L2-10): the SAME number the board
              and the decisions queue show, with its provenance named — so this
              header can no longer contradict the "CV analysis saved — score N"
              item in the timeline below without saying why. */}
          {canonicalScoreOf(entry) != null ? (
            <span className="rounded-md bg-white px-2 py-1 text-center" title={provenanceText(provenanceOf(entry)) ?? undefined}>
              <span className="block font-serif text-lg leading-none text-ink">{canonicalScoreOf(entry)}</span>
              <span className="block text-sm uppercase text-steel">{t("match")}</span>
              <span className="block max-w-[7rem] text-meta normal-case leading-tight text-steel">
                {provenanceText(provenanceOf(entry))}
              </span>
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

          {/* GH2 — GitHub evidence attached at add-to-pipeline (or just run from
              this drawer): corroborated vs claimed skills beside the interview
              outcomes, at the surface where advance/reject actually happens. */}
          {github ? (
            <div className="rounded-md border border-stone-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
                  <GitBranch size={13} /> {t("githubEvidence")}
                </p>
                <a
                  href={github.profileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="focus-ring font-mono text-sm text-coral hover:underline"
                >
                  @{github.username}
                </a>
              </div>
              {github.summary ? (
                <p className="mt-1 text-sm text-ink">{github.summary}</p>
              ) : null}
              {github.confirmedSkills.length ? (
                <p className="mt-1.5 text-sm text-ink">
                  <span className="font-semibold text-moss">{t("githubEvidenced")}</span>{" "}
                  {github.confirmedSkills.join(", ")}
                </p>
              ) : null}
              {github.unverifiedClaims.length ? (
                <p className="mt-1 text-sm text-ink">
                  <span className="font-semibold text-amber-700">{t("githubUnverified")}</span>{" "}
                  {github.unverifiedClaims.join(", ")}
                </p>
              ) : null}
              {github.hiddenStrengths.length ? (
                <p className="mt-1 text-sm text-ink">
                  <span className="font-semibold text-steel">{t("githubHidden")}</span>{" "}
                  {github.hiddenStrengths.join(", ")}
                </p>
              ) : null}
              {github.topRepositories.length ? (
                <p className="mt-1.5 flex flex-wrap gap-2">
                  {github.topRepositories.map((r) => (
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

          {/* Inbound applicants share only a handle at apply — offer the deep-dive
              on demand here; a successful run renders as the evidence card above. */}
          {!github && entry.githubHandle ? (
            <div className="rounded-md border border-stone-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
                  <GitBranch size={13} /> {t("githubEvidence")}
                </p>
                <a
                  href={`https://github.com/${entry.githubHandle}`}
                  target="_blank"
                  rel="noreferrer"
                  className="focus-ring font-mono text-sm text-coral hover:underline"
                >
                  @{entry.githubHandle}
                </a>
              </div>
              <p className="mt-1 text-sm text-steel">{t("githubRunHelp")}</p>
              <button
                type="button"
                onClick={runGithubDeepDive}
                disabled={ghBusy}
                className="focus-ring mt-2 inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-ink hover:border-coral/40 disabled:opacity-50"
              >
                <GitBranch size={13} className="text-coral" /> {ghBusy ? t("githubRunning") : t("githubRun")}
              </button>
              {ghErr ? <p role="alert" className="mt-1.5 text-sm text-red-700">{ghErr}</p> : null}
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

          {mergedHistory.length > 0 ? (
            <div>
              <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
                <History size={13} /> {t("history")}
              </p>
              <ol className="mt-2 space-y-1.5">
                {mergedHistory.map((row) =>
                  row.type === "event" ? (
                    <li key={row.key} className="flex items-start gap-2 text-sm">
                      <span className="mt-0.5">
                        <EventDot kind={row.ev.kind} />
                      </span>
                      <span className="min-w-0 flex-1 text-ink">{eventVerb(row.ev)}</span>
                      <span className="shrink-0 text-meta text-steel">{relativeTime(row.ev.createdAt)}</span>
                    </li>
                  ) : (
                    <li key={row.key} className="flex items-start gap-2 text-sm">
                      <TimelineItemRow item={row.item} />
                      <span className="shrink-0 text-meta text-steel">{relativeTime(row.item.at)}</span>
                    </li>
                  )
                )}
              </ol>
            </div>
          ) : null}

          {entry.status === "active" ? (
            <div>
              <label htmlFor="move-stage" className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
                <ArrowLeftRight size={13} /> {t("moveStage")}
              </label>
              <p className="mt-1 text-sm text-steel">{t("moveStageHelp")}</p>
              <Select
                id="move-stage"
                ariaLabel={t("moveStage")}
                value={entry.stage}
                disabled={movingStage}
                onChange={(v) => moveStage(v)}
                size="sm"
                className="mt-2 w-full"
                options={moveStageSelectValues(entry.stage).map((s) => ({
                  value: s,
                  label: `${enumLabel("stage", s)}${s === entry.stage ? t("current") : ""}`,
                }))}
              />
              {moveErr ? <p role="alert" className="mt-1.5 text-sm text-red-700">{moveErr}</p> : null}
            </div>
          ) : null}

          {/* Persistent candidate note: always visible, debounce-autosaved to the
              entry (set_notes) with a quiet saving/saved hint — the durable home
              for call facts the Interview-only scorecard box used to swallow. */}
          <div>
            <label htmlFor="candidate-note" className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
              <NotebookPen size={13} /> {t("candidateNotes")}
              <span
                aria-live="polite"
                className={`ml-auto normal-case tracking-normal ${noteStatus === "error" ? "text-red-700" : noteStatus === "saved" ? "text-moss" : "text-steel"}`}
              >
                {noteStatus === "saving" ? t("candidateNotesSaving") : null}
                {noteStatus === "saved" ? t("candidateNotesSaved") : null}
                {noteStatus === "error" ? t("candidateNotesSaveFailed") : null}
              </span>
            </label>
            <TextArea
              id="candidate-note"
              value={candNote}
              onChange={(e) => {
                noteDirtyRef.current = true;
                setNoteStatus("saving");
                setCandNote(e.target.value);
              }}
              rows={3}
              maxLength={NOTE_MAX}
              placeholder={t("candidateNotesPlaceholder")}
              sizeVariant="sm"
              className="mt-1"
            />
          </div>

          <ConsentPanel key={entry.id} entryId={entry.id} />

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
              <TextArea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder={t("notesPlaceholder")}
                sizeVariant="sm"
                className="mt-1"
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
                  {/* REC-10 — the note reflects the outbox row's REAL status: green
                      "sent" only for a relayed send; a queued row (no relay) says so
                      honestly and keeps the copy panel as the delivery path. */}
                  {Boolean(voice.data.configured) && deliveryClaimOf(voice.data, "delivered") === "sent" ? (
                    <p className="text-sm text-moss">{t("inviteSent")}</p>
                  ) : null}
                  {Boolean(voice.data.configured) && deliveryClaimOf(voice.data, "delivered") === "queued" ? (
                    <p className="text-sm text-steel">{t("inviteQueued")}</p>
                  ) : null}
                  {Boolean(voice.data.configured) && deliveryClaimOf(voice.data, "delivered") === "failed" ? (
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
                <div className="mt-2 space-y-1.5">
                  <TokenLinkPanel link={sched} />
                  {/* REC-10 — same truth-language as the voice invite: `dispatched`
                      only ever meant "an outbox row was recorded", which is not
                      delivery when no relay is configured. */}
                  {deliveryClaimOf(sched.data, "dispatched") === "sent" ? (
                    <p className="text-sm text-moss">{t("schedInviteSent")}</p>
                  ) : deliveryClaimOf(sched.data, "dispatched") === "queued" ? (
                    <p className="text-sm text-steel">{t("schedInviteQueued")}</p>
                  ) : (
                    <p className="text-sm text-amber-700">{t("schedInviteNotSent")}</p>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          {error ? <p role="alert" className="rounded-md bg-red-50 p-2.5 text-sm text-red-700">{error}</p> : null}

          {result ? <ResultView result={result} roleFamily={entry.roleFamily} /> : null}

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

// c6524f2f — one row of the cross-store timeline chapters (analysis /
// interview / invite / offer), merged into the history list above. An analysis
// row deep-links to its saved report and carries the recruiter's disposition.
function TimelineItemRow({ item }: { item: CandidateTimelineItem }) {
  const t = useTranslations("pipeline.drawer.timeline");
  const tDisposition = useTranslations("history.disposition");
  // REC-10 — with no delivery relay a dispatched invite is a terminal outbox
  // row, so the chapter reads "queued", not "sent" (null = unknown keeps the
  // optimistic label rather than accusing a configured relay).
  const relayConfigured = useDeliveryCapability();
  const Icon =
    item.kind === "analysis" ? FileText : item.kind === "interview" ? Phone : item.kind === "invite" ? Calendar : Banknote;
  const label = (() => {
    switch (item.kind) {
      case "analysis":
        return item.score != null ? t("analysis", { score: item.score }) : t("analysisNoScore");
      case "interview":
        return item.status === "completed" ? t("interviewCompleted") : t("interviewCreated");
      case "invite":
        return item.status === "confirmed"
          ? `${t("inviteConfirmed")}${item.slot ? ` — ${item.slot}` : ""}`
          : t(relayConfigured === false ? "inviteQueued" : "inviteSent");
      case "offer":
        return item.status === "accepted" ? t("offerAccepted") : item.status === "declined" ? t("offerDeclined") : t("offerExtended");
      default:
        return item.kind;
    }
  })();
  const disposition =
    item.kind === "analysis" && item.disposition && ["advance", "hold", "pass"].includes(item.disposition)
      ? tDisposition(item.disposition as "advance" | "hold" | "pass")
      : null;
  return (
    <>
      <Icon size={13} className="mt-0.5 shrink-0 text-steel" aria-hidden />
      <span className="min-w-0 flex-1 text-ink">
        {label}
        {disposition ? (
          <span className="ml-1.5 rounded-full bg-stone-100 px-1.5 py-0.5 text-meta font-semibold uppercase text-steel">
            {disposition}
          </span>
        ) : null}
        {item.kind === "analysis" && item.slug ? (
          <Link
            href={`/history/${encodeURIComponent(item.slug)}`}
            className="focus-ring ml-1.5 font-semibold text-coral hover:underline"
          >
            {t("openReport")}
          </Link>
        ) : null}
      </span>
    </>
  );
}
