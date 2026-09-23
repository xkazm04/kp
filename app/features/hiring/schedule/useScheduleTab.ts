"use client";

// All state, fetch/poll effects and actions for ScheduleTab, split out of
// ScheduleTab.tsx so the component file stays under the 200-line cap. Returns
// everything the tab's render (and its list/aside sub-components) need; no
// JSX here.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { TargetAndTransition } from "framer-motion";
import { DEFAULT_SLOT, type SchedEntry } from "./ScheduleTypes";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { gridSlotToIso, isoToDateSlot } from "@/app/_lib/schedule-slots";
import { useErrorMessage } from "@/app/_lib/use-error-message";
// Type-only — no better-sqlite3 pulled into this client bundle.
import type { ScheduleInvite } from "@/app/_lib/schedule-store";
import { sharedGetJson } from "@/app/features/shared/sharedGet";
import { notifyDataChanged, useLiveRefresh } from "@/app/features/shell/live-refresh";
// The one agenda's write-through + declared effects (challenge-r02 schedule-calendar-invites/A).
import {
  applyMutation,
  effectsFor,
  isOwnEcho,
  type AgendaMutation,
  type AgendaState,
  type AgendaWriteResult,
  type InviteActionVerb,
  type ScheduleAgendaView,
} from "./scheduleAgenda";
import { seedGrid, type SlotSource } from "./scheduleGridSeeds";
// Each pending card's state from its candidate's live invite (challenge-r02 slot B).
import { liveInviteFor, pendingCardState, sendLinkNotice, type PendingCardState } from "./schedulePendingCardState";
import { toast } from "@/app/_components/toast-store";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
// The two derived lists + the poll cadence, extracted and unit-pinned (schedule-ui-2).
import { bookedMarkersFrom, interviewedEntriesFrom } from "./scheduleTabDerived";
import { pollDelayMs, pollIsStale } from "./schedulePollBackoff";

export type IvStatus = { sessionId: string; status: string; hasTranscript: boolean; endedAt: string | null };

export function useScheduleTab() {
  const t = useTranslations("scheduleTab");
  // API failures resolve from the machine `code`, never the server's English
  // `error` — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  const format = useFormatter();
  // Display a stored dated slot "YYYY-MM-DD HH:MM" as a localized "Tue 22 Jul · 14:00".
  // The canonical value (kept in `picks`, sent to the server) stays the ISO date grammar.
  // A legacy/unknown value (e.g. a weekday-relative "Tue 14:00") is shown as-is, so
  // wall-clock display of older data is unaffected.
  const slotLabel = (slot: string): string => {
    const [date = "", time = ""] = slot.split(" ");
    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!dm) return slot.trim();
    const d = format.dateTime(new Date(Date.UTC(+dm[1], +dm[2] - 1, +dm[3], 12)), {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
    return time ? `${d} · ${time}` : d;
  };
  // A legacy weekday-relative slot ("Tue 14:00") → a concrete dated slot for the grid,
  // by resolving it to the next matching future instant (gridSlotToIso) and placing that
  // back on the dated grid. Used to seed entries that only have the old free-text detail.
  const weekdayToDateSlot = (weekdaySlot: string): string | null => {
    const r = gridSlotToIso(weekdaySlot);
    return r ? isoToDateSlot(r.value) : null;
  };
  // THE agenda — the pending entries AND the invite list, one state, one owner. The
  // lifecycle panel this tab renders reads it through props (agendaForPanel below)
  // instead of holding a second copy it fetched itself; every recruiter write lands
  // here through applyMutation (scheduleAgenda.ts), so the grid and the panel cannot
  // disagree about which hours are taken or which invites need attention.
  const [agenda, setAgenda] = useState<AgendaState>({ entries: null, invites: [] });
  const entries = agenda.entries;
  const invites = agenda.invites;
  const [error, setError] = useState<string | null>(null);
  // A REFUSAL of one card's action, carried beside that card rather than in the
  // tab-level banner. The banner sits above the whole grid, ~26rem from the aside
  // where the recruiter clicked, and every book refusal used to render there as
  // t("loadFailed") — "Failed to load.", the copy of a fetch that never happened.
  // A refusal is about ONE candidate ("that hour is taken", "they were rejected
  // in another tab"), so it renders inline under that candidate's actions, where
  // the eye already is. Not the AI round's toast: a toast is right for a
  // transient success ("link copied") but a refusal here names the next action
  // (pick another cell) and must stay on screen while the recruiter takes it.
  const [actionError, setActionError] = useState<{ entryId: string; message: string } | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  // Direction 3 — the grid renders from the ONE scheduling engine. Confirmed invites
  // (recruiter- or candidate-self-booked) seed where each candidate sits and appear as
  // read-only booked markers, so the grid and the invite store can't diverge.
  // (`invites` is agenda.invites above.)
  //
  // The agenda read failing is not fatal to the grid (it degrades to the legacy
  // approvalDetail seeds) but the lifecycle panel says so rather than render an empty
  // lifecycle as the truth.
  const [invitesFailed, setInvitesFailed] = useState(false);
  // "Now" captured when the agenda last changed, so the panel's upcoming/past split is
  // a pure function of state during render (react-hooks/purity).
  const [loadedAt, setLoadedAt] = useState(0);
  // GET /api/schedule is bounded (a clamped `?limit=`, 200 by default) and says when
  // it hit the bound. It matters MORE here than on the lifecycle panel: the grid draws
  // its booked markers from this list, so an invite past the bound is an hour that IS
  // taken and is not drawn as taken. Say the list is partial rather than imply it is
  // whole.
  const [invitesTruncated, setInvitesTruncated] = useState(false);
  // Where each seeded cell came from (booked invite / legacy detail / flat guess),
  // so a guess can be drawn as a guess. See scheduleGridSeeds.ts.
  const [pickSources, setPickSources] = useState<Record<string, SlotSource>>({});
  // The zone every time on this surface is expressed in, stated by the server —
  // KP_INTERVIEW_TZ is not readable from a client bundle, and a wrong zone label is
  // worse than none.
  const [interviewTz, setInterviewTz] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [prepEntry, setPrepEntry] = useState<SchedEntry | null>(null);
  // entry id → { createdAt, interviewer, hasHumanScorecard, stale } for entries with
  // a prep artifact (PREP5; the scorecard flag keeps human-led rounds visible below;
  // `stale` is Direction 1's "JD edited since this prep" flag).
  const [prepared, setPrepared] = useState<
    Record<string, { createdAt: string; interviewer: string | null; hasHumanScorecard: boolean; stale: boolean }>
  >({});
  const [interviews, setInterviews] = useState<Record<string, IvStatus>>({});
  const [creatingIv, setCreatingIv] = useState<string | null>(null);
  const [transcriptEntry, setTranscriptEntry] = useState<SchedEntry | null>(null);
  // Direction of the most recent confirm/decline. AnimatePresence reads it via
  // `custom` to resolve the leaving card's slide-out at removal time, so the card
  // can be dropped from state in the same tick (no per-card flag, no effect).
  // Only one card leaves at a time (the action buttons gate on `busy`).
  const [lastDir, setLastDir] = useState<"confirm" | "decline">("confirm");
  const reduced = useReducedMotion();

  // `refresh` is for reloads that follow a mutation — see sharedGet.ts. This hook is
  // the agenda's only reader now (the lifecycle panel takes it as props), so one tab
  // mount issues one GET /api/schedule by construction, not by in-flight coalescing.
  //
  // Ordering: a load that started before a newer load OR before a write-through is
  // stale by the time it lands — adopting it would put back the row the recruiter
  // just changed. `agendaSeq` is bumped by both; a response whose seq is no longer
  // current is dropped. `loadsInFlight` lets a write that supersedes a pending read
  // (e.g. a live-refresh reload) re-issue it, so the change that read was fetching
  // is not lost with it.
  const agendaSeq = useRef(0);
  const loadsInFlight = useRef(0);
  const load = (opts?: { refresh?: boolean }) => {
    const seq = ++agendaSeq.current;
    loadsInFlight.current += 1;
    return Promise.all([
      sharedGetJson<{ entries?: SchedEntry[]; error?: string }>("/api/pipeline", opts),
      // The invite store — the engine the grid now renders from. Best-effort for the
      // grid: if it fails, the grid still works off the legacy approvalDetail strings
      // (and the lifecycle panel states the failure).
      sharedGetJson<{ invites?: ScheduleInvite[]; interviewTz?: string; truncated?: boolean }>("/api/schedule", opts).then(
        (s) => ({ ...s, failed: false }),
        () => ({ invites: undefined as ScheduleInvite[] | undefined, interviewTz: undefined as string | undefined, truncated: false, failed: true })
      ),
    ])
      .then(([p, s]) => {
        if (seq !== agendaSeq.current) return; // superseded by a newer load or a write
        if (p.error) throw new Error(p.error);
        const all = (p.entries as SchedEntry[]) ?? [];
        // Awaiting-slot candidates (the calendar) PLUS those already voice-interviewed
        // (now at scorecard_review) so a finished interview stays visible with its transcript.
        const sched = all.filter(
          (e) => (e.approvalKind === "calendar" || e.approvalKind === "scorecard_review") && e.status === "active"
        );
        // A failed agenda read keeps the last good list rather than blank the grid's
        // booked markers (an hour that IS taken would be drawn free).
        const invs = (s.invites as ScheduleInvite[] | undefined) ?? [];
        setInvitesFailed(s.failed);
        setAgenda((prev) => ({ entries: sched, invites: s.failed ? prev.invites : invs }));
        if (!s.failed) setInvitesTruncated(s.truncated === true);
        setLoadedAt(Date.now());
        setError(null);
        // Seed each candidate's grid cell from the ENGINE first: an invite's canonical
        // slot_at (converted to the grid's wall-clock cell) wins over the legacy
        // free-text approvalDetail, which is the back-compat fallback for entries with
        // no invite yet. So a self-booked or recruiter-booked time shows in the right cell.
        //
        // WHICH invite: the agenda can hold several per entry (a re-invite history), and
        // a `new Map(...)` over the list kept whichever sorted LAST in the read's ORDER
        // BY. liveInviteFor picks deliberately (confirmed, else a live pending link, else
        // the newest closed one), the same pick the pending card's state reads.
        const seededAt = Date.now();
        if (typeof s.interviewTz === "string" && s.interviewTz) setInterviewTz(s.interviewTz);
        const seeded = seedGrid(
          sched
            .filter((e) => e.approvalKind === "calendar")
            .map((e) => {
              const inv = liveInviteFor(e.id, invs, seededAt);
              // Only a CONFIRMED invite is a fact; a pending one carries no slot_at.
              const fromInvite = inv?.status === "confirmed" && inv.slotAt ? isoToDateSlot(inv.slotAt) : null;
              // Legacy approvalDetail is a weekday-relative string; resolve it to a
              // concrete upcoming date so it lands in a real grid cell. DEFAULT is the
              // last resort for an entry with neither an invite nor a parseable detail.
              const fromLegacy = e.approvalDetail ? weekdayToDateSlot(e.approvalDetail) : null;
              return {
                id: e.id,
                fromInvite,
                fromLegacy,
                fallback: weekdayToDateSlot(DEFAULT_SLOT) || DEFAULT_SLOT,
              };
            })
        );
        setPicks(seeded.picks);
        setPickSources(seeded.sources);
      })
      .catch((e) => {
        if (seq === agendaSeq.current) setError(e instanceof Error ? e.message : t("loadFailed"));
      })
      .finally(() => {
        loadsInFlight.current -= 1;
      });
  };
  useEffect(() => {
    load();
  }, []);

  // Rung 2 of the invalidation hierarchy: a data-changed signal from another view or
  // window (a candidate drawer move, the board, the simulation driver) reloads the
  // agenda — both lists, coalesced by the bus's debounce. Before this the tab was a
  // mount-only snapshot. Our OWN notify comes back through the same window event; the
  // write it announced is already applied (and re-read where effectsFor asks), so
  // that echo is skipped rather than fetched twice.
  const lastOwnNotifyAt = useRef(0);
  useLiveRefresh(() => {
    if (isOwnEcho(lastOwnNotifyAt.current, Date.now())) return;
    void load({ refresh: true });
  });

  // Rung 1 — write-through. Adopt what the route answered into THE agenda, then honour
  // the verb's declared effects (scheduleAgenda.ts effectsFor): re-read where the
  // write moved server state its response does not carry, announce where other views
  // render what moved. A write supersedes any read still in flight (that read predates
  // it); if one was in flight, it is re-issued so its news is not dropped.
  const commitMutation = (m: AgendaMutation, opts?: { reload?: boolean }) => {
    const readPending = loadsInFlight.current > 0;
    agendaSeq.current += 1;
    setAgenda((prev) => applyMutation(prev, m));
    setLoadedAt(Date.now());
    const fx = effectsFor(m.kind);
    if (fx.refetchEntries || opts?.reload || readPending) void load({ refresh: true });
    if (fx.notify) {
      lastOwnNotifyAt.current = Date.now();
      notifyDataChanged();
    }
  };

  // The lifecycle panel's invite verbs (accept a proposal, cancel, no-show, decline
  // proposals, resolve a reconcile). The panel owns its busy/armed latches and its
  // toasts; the write and its landing are the owner's. Answers the parsed body so the
  // panel can resolve a refusal code in the reader's language.
  const runInviteAction = async (
    token: string,
    action: InviteActionVerb,
    slotAt?: string
  ): Promise<AgendaWriteResult> => {
    const r = await fetch("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, action, slotAt }),
    });
    const body = ((await r.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    if (!r.ok) return { ok: false, body };
    const inv = (body.invite as ScheduleInvite | undefined) ?? null;
    commitMutation({ kind: action, invite: inv, entryId: inv?.entryId ?? null });
    return { ok: true, body };
  };

  // Mint a scheduling link (POST /api/schedule/invite): a Closed row's re-invite, or a
  // pending card's first link. The route mints a NEW token and answers no row, so the
  // owner re-reads the agenda (the fresh pending link lands in Awaiting and the card
  // turns to "link sent").
  const mintLink = async (entryId: string, kind: "reinvite" | "send_link"): Promise<AgendaWriteResult> => {
    const r = await fetch("/api/schedule/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryId }),
    });
    const body = ((await r.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    if (!r.ok) return { ok: false, body };
    commitMutation({ kind, invite: null }, { reload: true });
    return { ok: true, body };
  };
  const reinviteEntry = (entryId: string) => mintLink(entryId, "reinvite");

  // The pending card's own actions (challenge-r02 slot B): each card's first action
  // follows its candidate's live invite (schedulePendingCardState.ts), not a blind
  // Confirm of the seeded cell. A refusal renders under that card, like a book refusal.
  //
  // Send the candidate their self-scheduling link. The toast repeats the route's
  // TRUTHFUL delivery claim (sent / queued / failed), never a green "sent" over a
  // message nothing will deliver.
  const sendLink = async (e: SchedEntry) => {
    setBusy(e.id);
    setActionError(null);
    try {
      const res = await mintLink(e.id, "send_link");
      if (!res.ok) {
        setActionError({ entryId: e.id, message: errMsg(res.body, t("sendLink.refused")) });
        return;
      }
      const notice = sendLinkNotice(res.body);
      toast[notice.variant](t(notice.key, { name: e.candidateLabel }));
    } catch {
      setActionError({ entryId: e.id, message: t("sendLink.refused") });
    } finally {
      setBusy(null);
    }
  };
  // Accept one of the candidate's proposed times where the recruiter is reading their
  // card: the lifecycle panel's accept_proposal verb, written through the one agenda
  // (the card leaves the pending list; the booking lands in Upcoming and on the grid).
  const acceptProposal = async (e: SchedEntry, token: string | null, slotAt: string) => {
    if (!token) return;
    setBusy(e.id);
    setActionError(null);
    try {
      const res = await runInviteAction(token, "accept_proposal", slotAt);
      if (!res.ok) setActionError({ entryId: e.id, message: errMsg(res.body, t("bookFailed")) });
      else setLastDir("confirm");
    } catch {
      setActionError({ entryId: e.id, message: t("bookFailed") });
    } finally {
      setBusy(null);
    }
  };
  // Copy an awaiting candidate's link (the recruiter re-sends it through their own
  // channel). A denied clipboard says so rather than leave a stale clipboard to paste.
  const copyLink = (token: string | null) => {
    if (!token) return;
    const url = `${publicBaseUrl(window.location.origin)}/schedule/${token}`;
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(url))
      .then(() => toast.success(t("cardState.linkCopied")))
      .catch(() => toast.error(t("cardState.copyFailed")));
  };

  // The meeting-link PATCH answers the row re-read AFTER its calendar refresh (so it
  // can carry a changed calendarEventState) — merged into the one list.
  const adoptMeetingPatch = (token: string, patch: Partial<ScheduleInvite>) =>
    commitMutation({ kind: "meeting_url", token, patch });

  // What the lifecycle panel renders from: the same `invites` the grid reads.
  const agendaForPanel: ScheduleAgendaView = {
    invites: entries === null && !invitesFailed ? null : invites,
    loadedAt,
    truncated: invitesTruncated,
    failed: invitesFailed,
    runInviteAction,
    reinviteEntry,
    adoptMeetingPatch,
  };

  // MEMOIZED ON `entries`, not rebuilt per render. These three derived lists used to
  // be fresh `.filter()` calls in the render body, which meant `calendarEntryIds` and
  // `bookedMarkers` below — real useMemos — recomputed every single render because
  // their input array was a new identity every time. The interview poll (every 6s)
  // therefore re-rendered the whole week grid, chips and all, with byte-identical
  // data. `entries` only changes when a load actually returns something new.
  const pending = useMemo(() => entries ?? [], [entries]);
  const entryIds = useMemo(() => pending.map((e) => e.id).join(","), [pending]);
  const calendarEntries = useMemo(() => pending.filter((e) => e.approvalKind === "calendar"), [pending]);
  // Direction 3 — booked markers: confirmed invites shown as read-only occupied cells
  // on the grid, so a candidate who self-booked via their token (and has since advanced
  // out of the pending list) still occupies their slot and can't be double-booked.
  // Entries already rendered as assignable chips are excluded to avoid a double render.
  const calendarEntryIds = useMemo(() => new Set(calendarEntries.map((e) => e.id)), [calendarEntries]);
  const bookedMarkers = useMemo(() => bookedMarkersFrom(invites, calendarEntryIds), [invites, calendarEntryIds]);
  // entry id -> what that pending card offers first: send the link, a sent link's age,
  // a fresh link for an expired one, the candidate's proposals, a stall pointer, or
  // Confirm, which is primary ONLY where a confirmed invite backs the cell.
  // `loadedAt` is "now" as of the last agenda change, so this stays pure in render.
  const cardStates = useMemo(() => {
    const out: Record<string, PendingCardState> = {};
    for (const e of calendarEntries) {
      out[e.id] = pendingCardState(e, liveInviteFor(e.id, invites, loadedAt), pickSources[e.id], loadedAt);
    }
    return out;
  }, [calendarEntries, invites, pickSources, loadedAt]);
  // Interviewed = moved past scheduling with either a saved voice transcript or a
  // recruiter-filled human scorecard — a human-led round has no transcript, but its
  // candidate must stay visible (and the prep modal reachable) after the verdict
  // gates the entry to scorecard_review (interview-prep-rubric #2).
  const interviewedEntries = useMemo(
    () => interviewedEntriesFrom(pending, interviews, prepared),
    [pending, interviews, prepared]
  );
  // entry id → the candidate's own IANA zone, captured when THEY booked
  // (schedule-store `candidate_tz`). Stored since idea-b51106df and rendered only on
  // the agenda row until now: the recruiter reading the pending list could not see
  // that "14:00" is the middle of the night for this candidate.
  const candidateZones = useMemo(() => {
    const zones: Record<string, string> = {};
    for (const inv of invites) {
      if (inv.entryId && inv.candidateTz) zones[inv.entryId] = inv.candidateTz;
    }
    return zones;
  }, [invites]);
  // Which candidates already have a generated interview-prep artifact (toggles
  // the button label). Re-checked when the prep modal closes (a fresh generate).
  useEffect(() => {
    if (!entryIds) return;
    // `alive` (the same idiom as the interview poll below): this effect re-fires on
    // every prep-modal open AND close, so opening the modal, generating a pack and
    // closing it leaves two reads in flight. Without the latch the OPEN read landing
    // last overwrote the CLOSE read's answer with a snapshot taken before the generate
    // — the card kept offering "Generate" for a pack that already exists (and the
    // human-scorecard flag that keeps an interviewed candidate visible stayed unset)
    // until some other dependency changed.
    let alive = true;
    fetch(`/api/interview-prep?entries=${encodeURIComponent(entryIds)}`)
      .then((r) => r.json())
      .then((p) => alive && setPrepared(p.prepared ?? {}))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [entryIds, prepEntry]);

  // Poll which candidates have a finished voice interview (transcript ready).
  //
  // Three properties this loop did NOT have (schedule-ui-2). It was a flat
  // `setInterval(refresh, 6000)` whose failure was swallowed by `.catch(() => undefined)`:
  //
  //  * It ran in a BACKGROUND tab forever — 600 SQLite-backed requests an hour for a
  //    surface nobody was looking at. Now it is gated on `document.visibilityState`:
  //    hidden ⇒ no timer at all, and becoming visible refreshes immediately (the same
  //    "you came back, here is the truth" moment the focus listener already served).
  //  * A failing server produced 600 silent failures an hour. Now consecutive failures
  //    back the cadence off 6s → 12 → 24 → 48 → 60s and hold there (schedulePollBackoff.ts
  //    states the curve); a success resets to 6s, so a recovered network is picked up
  //    without a reload.
  //  * Nothing ever SAID the view was old. `liveStale` goes true from the second
  //    consecutive failure and the tab renders a pill with a retry — the alternative is
  //    an hour-old snapshot rendered as if it were live.
  const failuresRef = useRef(0);
  const [liveStale, setLiveStale] = useState(false);
  // Bumped by the retry button to re-run the effect (and so poll immediately).
  const [pollNonce, setPollNonce] = useState(0);
  const retryLive = useCallback(() => {
    failuresRef.current = 0;
    setPollNonce((n) => n + 1);
  }, []);
  useEffect(() => {
    if (!entryIds) return;
    let alive = true;
    let timer: number | undefined;
    const arm = () => {
      if (!alive) return;
      window.clearTimeout(timer);
      // A hidden tab arms nothing; the visibilitychange handler below restarts it.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      timer = window.setTimeout(refresh, pollDelayMs(failuresRef.current));
    };
    const refresh = () => {
      if (!alive) return;
      fetch(`/api/interview/by-entry?entries=${encodeURIComponent(entryIds)}`)
        .then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.json();
        })
        .then((d) => {
          if (!alive) return;
          failuresRef.current = 0;
          setLiveStale(false);
          setInterviews(d.status ?? {});
        })
        .catch(() => {
          // Best-effort by design — a failed status poll must never break the tab. What
          // it may NOT do is stay invisible: the count drives both the backoff and the pill.
          if (!alive) return;
          failuresRef.current += 1;
          setLiveStale(pollIsStale(failuresRef.current));
        })
        .finally(arm);
    };
    const onVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        window.clearTimeout(timer);
        return;
      }
      refresh();
    };
    refresh();
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [entryIds, transcriptEntry, pollNonce]);

  const startInterview = async (e: SchedEntry) => {
    setCreatingIv(e.id);
    setError(null);
    try {
      const r = await fetch("/api/interview/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId: e.id }),
      });
      const d = await r.json();
      // 409 = the server's live-call guard refused a reissue (the 6s status poll
      // can lag behind a just-started call) — explain it, localized, instead of
      // the generic failure line.
      if (r.status === 409) throw new Error(t("interviewLiveRefused"));
      if (!r.ok) throw new Error(errMsg(d, t("startFailed")));
      window.open(d.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("startFailed"));
    } finally {
      setCreatingIv(null);
    }
  };

  const act = async (e: SchedEntry, action: "approve_event" | "reject") => {
    setBusy(e.id);
    setActionError(null);
    // The confirmed invite the book route answers (route.ts: jsonOk({ invite, ... })),
    // adopted into the agenda below so the just-booked hour is drawn taken and the
    // lifecycle panel's Upcoming shows it — it used to be dropped on the floor.
    let bookedInvite: ScheduleInvite | null = null;
    try {
      if (action === "approve_event") {
        // Route the grid confirm through the ONE scheduling engine: produce/update a
        // canonical, collision-checked, reminder-eligible invite for the picked cell
        // AND advance the pipeline entry server-side (Direction: close the grid-book
        // drift gap). `book` now performs approve_event itself and flags needs_reconcile
        // on a stage-gate failure, so there is no separate client advance call to leave
        // a confirmed booking whose entry never advanced. A genuine collision blocks the
        // booking (409) — the recruiter picks another cell — instead of double-booking.
        const bookRes = await fetch("/api/schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "book", entryId: e.id, dateSlot: picks[e.id] }),
        });
        const bd = await bookRes.json().catch(() => ({}));
        if (!bookRes.ok) {
          // The server answers a REFUSAL code (SCHEDULE_SLOT_TAKEN,
          // SCHEDULE_CANDIDATE_INACTIVE, SCHEDULE_BOOK_FAILED,
          // SCHEDULE_SLOT_UNRESOLVED, PIPELINE_ENTRY_NOT_FOUND); useErrorMessage
          // resolves it in the reader's language. The fallback is the ACTION's own
          // copy, never the load banner's.
          setActionError({ entryId: e.id, message: errMsg(bd, t("bookFailed")) });
          setBusy(null);
          // The refusal is usually about state that moved (a slot taken, a
          // candidate rejected elsewhere) — resync so the grid shows the world
          // the server just described.
          load({ refresh: true });
          return;
        }
        bookedInvite = ((bd as { invite?: ScheduleInvite }).invite as ScheduleInvite | undefined) ?? null;
      } else {
        // Decline → terminal reject on the pipeline entry (no booking involved).
        const r = await fetch(`/api/pipeline/${e.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, detail: undefined }),
        });
        if (!r.ok) {
          // Previously `throw new Error()` into a catch that only re-loaded: the
          // card silently reappeared and NOTHING said the rejection had not been
          // recorded. The board's own PIPELINE_* codes localize here.
          const d = await r.json().catch(() => ({}));
          setActionError({ entryId: e.id, message: errMsg(d, t("declineFailed")) });
          setBusy(null);
          load({ refresh: true });
          return;
        }
      }
      // Record the direction, then drop the card. AnimatePresence resolves the
      // leaving card's exit variant from its `custom` (below) at removal time, so
      // confirm slides right and decline slides left.
      setLastDir(action === "approve_event" ? "confirm" : "decline");
      commitMutation(
        action === "approve_event"
          ? { kind: "book", entryId: e.id, invite: bookedInvite }
          : { kind: "reject", entryId: e.id, invite: null }
      );
      if (selectedId === e.id) setSelectedId(null);
    } catch {
      // Recovery after a failed action — must not reuse a pre-action response.
      load({ refresh: true });
    } finally {
      setBusy(null);
    }
  };

  // Exit variant resolved per-removal from AnimatePresence's `custom`: confirm
  // washes moss and slides right (advances); decline washes coral and slides left
  // (sent back). Collapses to a plain fade under the OS "reduce motion" setting.
  // Colors resolve through the brand tokens (coral/moss re-skin under Spark
  // Dark); color-mix keeps the 8% wash on whatever the theme resolves them to.
  const cardExit = (dir: "confirm" | "decline"): TargetAndTransition =>
    reduced
      ? { opacity: 0, transition: { duration: 0.12 } }
      : dir === "decline"
        ? { opacity: 0, x: -36, backgroundColor: "color-mix(in srgb, var(--color-coral) 8%, transparent)", borderColor: "var(--color-coral)", transition: { duration: 0.22, ease: "easeIn" } }
        : { opacity: 0, x: 36, backgroundColor: "color-mix(in srgb, var(--color-moss) 8%, transparent)", borderColor: "var(--color-moss)", transition: { duration: 0.22, ease: "easeIn" } };

  return {
    t,
    entries,
    error,
    actionError,
    picks,
    pickSources,
    candidateZones,
    interviewTz,
    invitesTruncated,
    selectedId,
    setSelectedId,
    busy,
    prepEntry,
    setPrepEntry,
    prepared,
    interviews,
    liveStale,
    retryLive,
    creatingIv,
    transcriptEntry,
    setTranscriptEntry,
    lastDir,
    reduced,
    load,
    agendaForPanel,
    calendarEntries,
    bookedMarkers,
    interviewedEntries,
    startInterview,
    act,
    cardStates,
    loadedAt,
    sendLink,
    acceptProposal,
    copyLink,
    cardExit,
    slotLabel,
  };
}
