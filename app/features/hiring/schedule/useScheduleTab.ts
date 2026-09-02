"use client";

// All state, fetch/poll effects and actions for ScheduleTab, split out of
// ScheduleTab.tsx so the component file stays under the 200-line cap. Returns
// everything the tab's render (and its list/aside sub-components) need; no
// JSX here.

import { useEffect, useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { TargetAndTransition } from "framer-motion";
import { DEFAULT_SLOT, type SchedEntry } from "./ScheduleTypes";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { gridSlotToIso, isoToDateSlot } from "@/app/_lib/schedule-slots";
import { useErrorMessage } from "@/app/_lib/use-error-message";
// Type-only — no better-sqlite3 pulled into this client bundle.
import type { ScheduleInvite } from "@/app/_lib/schedule-store";
import { sharedGetJson } from "@/app/features/shared/sharedGet";

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
  const [entries, setEntries] = useState<SchedEntry[] | null>(null);
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
  const [invites, setInvites] = useState<ScheduleInvite[]>([]);
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

  // `refresh` is for reloads that follow a mutation — see sharedGet.ts. The mount
  // read shares its `/api/schedule` request with the invite-lifecycle panel, which
  // mounts in the same tick and needs the same agenda.
  const load = (opts?: { refresh?: boolean }) =>
    Promise.all([
      sharedGetJson<{ entries?: SchedEntry[]; error?: string }>("/api/pipeline", opts),
      // The invite store — the engine the grid now renders from. Best-effort: if it
      // fails, the grid still works off the legacy approvalDetail strings.
      sharedGetJson<{ invites?: ScheduleInvite[] }>("/api/schedule", opts).catch(() => ({ invites: [] as ScheduleInvite[] })),
    ])
      .then(([p, s]) => {
        if (p.error) throw new Error(p.error);
        const all = (p.entries as SchedEntry[]) ?? [];
        // Awaiting-slot candidates (the calendar) PLUS those already voice-interviewed
        // (now at scorecard_review) so a finished interview stays visible with its transcript.
        const sched = all.filter(
          (e) => (e.approvalKind === "calendar" || e.approvalKind === "scorecard_review") && e.status === "active"
        );
        const invs = (s.invites as ScheduleInvite[]) ?? [];
        setInvites(invs);
        setEntries(sched);
        // Seed each candidate's grid cell from the ENGINE first: an invite's canonical
        // slot_at (converted to the grid's wall-clock cell) wins over the legacy
        // free-text approvalDetail, which is the back-compat fallback for entries with
        // no invite yet. So a self-booked or recruiter-booked time shows in the right cell.
        const inviteByEntry = new Map(invs.filter((i) => i.entryId).map((i) => [i.entryId as string, i]));
        setPicks(
          Object.fromEntries(
            sched
              .filter((e) => e.approvalKind === "calendar")
              .map((e) => {
                const inv = inviteByEntry.get(e.id);
                const fromInvite = inv?.slotAt ? isoToDateSlot(inv.slotAt) : null;
                // Legacy approvalDetail is a weekday-relative string; resolve it to a
                // concrete upcoming date so it lands in a real grid cell. DEFAULT is the
                // last resort for an entry with neither an invite nor a parseable detail.
                const fromLegacy = e.approvalDetail ? weekdayToDateSlot(e.approvalDetail) : null;
                return [e.id, fromInvite || fromLegacy || weekdayToDateSlot(DEFAULT_SLOT) || DEFAULT_SLOT];
              })
          )
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : t("loadFailed")));
  useEffect(() => {
    load();
  }, []);

  const pending = entries ?? [];
  const entryIds = pending.map((e) => e.id).join(",");
  const calendarEntries = pending.filter((e) => e.approvalKind === "calendar");
  // Direction 3 — booked markers: confirmed invites shown as read-only occupied cells
  // on the grid, so a candidate who self-booked via their token (and has since advanced
  // out of the pending list) still occupies their slot and can't be double-booked.
  // Entries already rendered as assignable chips are excluded to avoid a double render.
  const calendarEntryIds = useMemo(() => new Set(calendarEntries.map((e) => e.id)), [calendarEntries]);
  const bookedMarkers = useMemo(
    () =>
      invites
        .filter((i) => i.status === "confirmed" && i.slotAt && (!i.entryId || !calendarEntryIds.has(i.entryId)))
        .map((i) => ({ id: i.token, dateSlot: isoToDateSlot(i.slotAt), candidateLabel: i.candidateLabel ?? "—" }))
        .filter((m): m is { id: string; dateSlot: string; candidateLabel: string } => m.dateSlot !== null),
    [invites, calendarEntryIds]
  );
  // Interviewed = moved past scheduling with either a saved voice transcript or a
  // recruiter-filled human scorecard — a human-led round has no transcript, but its
  // candidate must stay visible (and the prep modal reachable) after the verdict
  // gates the entry to scorecard_review (interview-prep-rubric #2).
  const interviewedEntries = pending.filter(
    (e) =>
      e.approvalKind === "scorecard_review" &&
      (interviews[e.id]?.hasTranscript || prepared[e.id]?.hasHumanScorecard)
  );
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
  // Re-checks on an interval + window focus, since the call happens in a tab the
  // recruiter opens, then returns from.
  useEffect(() => {
    if (!entryIds) return;
    let alive = true;
    const refresh = () =>
      fetch(`/api/interview/by-entry?entries=${encodeURIComponent(entryIds)}`)
        .then((r) => r.json())
        .then((d) => alive && setInterviews(d.status ?? {}))
        .catch(() => undefined);
    refresh();
    const timer = setInterval(refresh, 6000);
    window.addEventListener("focus", refresh);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [entryIds, transcriptEntry]);

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
      setEntries((prev) => (prev ? prev.filter((x) => x.id !== e.id) : prev));
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
    selectedId,
    setSelectedId,
    busy,
    prepEntry,
    setPrepEntry,
    prepared,
    interviews,
    creatingIv,
    transcriptEntry,
    setTranscriptEntry,
    lastDir,
    reduced,
    load,
    calendarEntries,
    bookedMarkers,
    interviewedEntries,
    startInterview,
    act,
    cardExit,
    slotLabel,
  };
}
