"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion, type TargetAndTransition } from "framer-motion";
import { ArrowRight, Calendar, Check, ClipboardList, FileText, Phone, UserRound, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { buildUrl, clearedTabScopedParams } from "@/app/features/tabs";
import { ScheduleCalendar } from "./ScheduleCalendar";
import { InviteLifecyclePanel } from "./InviteLifecyclePanel";
import { InterviewPrepModal } from "./InterviewPrepModal";
import { InterviewTranscriptModal } from "./InterviewTranscriptModal";
import { DEFAULT_SLOT, styleFor, type SchedEntry } from "./ScheduleTypes";
import { ChainEmptyState } from "@/app/_components/ChainEmptyState";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { isoToGridSlot } from "@/app/_lib/schedule-slots";
// Type-only — no better-sqlite3 pulled into this client bundle.
import type { ScheduleInvite } from "@/app/_lib/schedule-store";

type IvStatus = { sessionId: string; status: string; hasTranscript: boolean; endedAt: string | null };

// Shared candidate summary used by both the Pending and Interviewed lists: the
// truncated label + job title + archetype dot/label on the left, and the score
// (plus any list-specific `trailing` node, e.g. the proposed slot chip) on the
// right. Keeps the two lists provably consistent — a tweak here changes both.
function CandidateCardHeader({ entry, trailing }: { entry: SchedEntry; trailing?: ReactNode }) {
  const enumLabel = useEnumLabel();
  const s = styleFor(entry.archetype);
  const archLabel = enumLabel("archetype", entry.archetype);
  return (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">{entry.candidateLabel}</span>
        <span className="block truncate text-sm text-steel">{entry.jobTitle}</span>
        <span className="mt-1 inline-flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.bg}`} title={archLabel} aria-hidden />
          <span className="text-meta uppercase tracking-wide text-steel">{archLabel}</span>
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1.5">
        <ScoreBadge score={entry.matchScore} />
        {trailing}
      </span>
    </>
  );
}

export function ScheduleTab() {
  const t = useTranslations("scheduleTab");
  const router = useRouter();
  const search = useSearchParams();
  const enumLabel = useEnumLabel();
  // Display a stored "Day HH:MM" slot with the localized day; the canonical value
  // (sent to the server, kept in `picks`) stays English.
  const slotLabel = (slot: string): string => {
    const [d, ...rest] = slot.split(" ");
    return `${enumLabel("day", d)} ${rest.join(" ")}`.trim();
  };
  const [entries, setEntries] = useState<SchedEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  // Direction 3 — the grid renders from the ONE scheduling engine. Confirmed invites
  // (recruiter- or candidate-self-booked) seed where each candidate sits and appear as
  // read-only booked markers, so the grid and the invite store can't diverge.
  const [invites, setInvites] = useState<ScheduleInvite[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [prepEntry, setPrepEntry] = useState<SchedEntry | null>(null);
  // entry id → { createdAt, interviewer, hasHumanScorecard } for entries with a
  // prep artifact (PREP5; the scorecard flag keeps human-led rounds visible below).
  const [prepared, setPrepared] = useState<
    Record<string, { createdAt: string; interviewer: string | null; hasHumanScorecard: boolean }>
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

  const load = () =>
    Promise.all([
      fetch("/api/pipeline").then((r) => r.json()),
      // The invite store — the engine the grid now renders from. Best-effort: if it
      // fails, the grid still works off the legacy approvalDetail strings.
      fetch("/api/schedule").then((r) => r.json()).catch(() => ({ invites: [] })),
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
                const fromInvite = inv?.slotAt ? isoToGridSlot(inv.slotAt) : null;
                return [e.id, fromInvite || e.approvalDetail || DEFAULT_SLOT];
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
        .map((i) => ({ id: i.token, gridSlot: isoToGridSlot(i.slotAt), candidateLabel: i.candidateLabel ?? "—" }))
        .filter((m): m is { id: string; gridSlot: string; candidateLabel: string } => m.gridSlot !== null),
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
    fetch(`/api/interview-prep?entries=${encodeURIComponent(entryIds)}`)
      .then((r) => r.json())
      .then((p) => setPrepared(p.prepared ?? {}))
      .catch(() => undefined);
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
      if (!r.ok) throw new Error(d.error || t("startFailed"));
      window.open(d.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("startFailed"));
    } finally {
      setCreatingIv(null);
    }
  };

  const selected = useMemo(() => (entries ?? []).find((e) => e.id === selectedId) ?? null, [entries, selectedId]);

  const pickSlot = (slot: string) => {
    if (!selectedId) return;
    setPicks((p) => ({ ...p, [selectedId]: slot }));
  };

  const act = async (e: SchedEntry, action: "approve_event" | "reject") => {
    setBusy(e.id);
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
          body: JSON.stringify({ action: "book", entryId: e.id, gridSlot: picks[e.id] }),
        });
        const bd = await bookRes.json().catch(() => ({}));
        if (!bookRes.ok) {
          setError(typeof bd.error === "string" ? bd.error : t("loadFailed"));
          setBusy(null);
          return;
        }
      } else {
        // Decline → terminal reject on the pipeline entry (no booking involved).
        const r = await fetch(`/api/pipeline/${e.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, detail: undefined }),
        });
        if (!r.ok) throw new Error();
      }
      // Record the direction, then drop the card. AnimatePresence resolves the
      // leaving card's exit variant from its `custom` (below) at removal time, so
      // confirm slides right and decline slides left.
      setLastDir(action === "approve_event" ? "confirm" : "decline");
      setEntries((prev) => (prev ? prev.filter((x) => x.id !== e.id) : prev));
      if (selectedId === e.id) setSelectedId(null);
    } catch {
      load();
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

  return (
    <div data-sim="schedule" className="space-y-6">
      <header>
        <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
        <h2 className="mt-1 font-serif text-display text-ink">{t("title")}</h2>
        <p className="mt-1 max-w-2xl text-body text-steel">{t("intro")}</p>
      </header>

      {/* W6-3 — confirmed bookings, stalled invites and confirm/advance drift:
          the lifecycle the store tracked but no surface ever showed. */}
      <InviteLifecyclePanel />

      {error ? (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-base text-red-700">
          {error}
        </p>
      ) : entries == null ? (
        <p className="text-base text-steel">{t("loading")}</p>
      ) : calendarEntries.length === 0 && interviewedEntries.length === 0 ? (
        <ChainEmptyState
          icon={Calendar}
          title={t("emptyTitle")}
          body={t("emptyBody")}
          links={[{ tab: "decisions", label: t("emptyCta") }]}
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
          <ScheduleCalendar
            entries={calendarEntries}
            picks={picks}
            bookedMarkers={bookedMarkers}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onPickSlot={pickSlot}
          />

          <aside className="space-y-2">
            <h3 className="text-meta uppercase tracking-wide text-steel">
              {t("pendingInterviews")} <span className="text-coral">· {calendarEntries.length}</span>
            </h3>
            <AnimatePresence custom={lastDir}>
            {calendarEntries.map((e, i) => {
              const active = e.id === selectedId;
              const iv = interviews[e.id];
              return (
                <motion.div
                  key={e.id}
                  data-sim-entry={e.id}
                  layout={reduced ? false : "position"}
                  variants={{ exit: cardExit }}
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    transition: { delay: reduced ? 0 : i * 0.04, duration: reduced ? 0.12 : 0.24, ease: "easeOut" },
                  }}
                  exit="exit"
                  className={`rounded-lg border bg-white p-2.5 shadow-panel transition-colors ${active ? "border-coral" : "border-stone-200"}`}
                >
                  <button type="button" onClick={() => setSelectedId(e.id)} className="focus-ring flex w-full items-start gap-2 text-left">
                    <CandidateCardHeader
                      entry={e}
                      trailing={<span className="rounded bg-paper px-1.5 py-0.5 text-sm font-semibold text-ink">{slotLabel(picks[e.id] ?? "")}</span>}
                    />
                  </button>
                  {prepared[e.id]?.interviewer ? (
                    <p className="mt-1.5 flex items-center gap-1 truncate text-meta text-steel" title={t("interviewerTitle", { name: prepared[e.id]!.interviewer! })}>
                      <UserRound size={11} className="shrink-0 text-coral" /> {prepared[e.id]!.interviewer}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setPrepEntry(e)}
                    className="focus-ring mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-stone-200 text-sm font-semibold text-ink hover:border-coral/40"
                  >
                    <ClipboardList size={14} className="text-coral" />
                    {prepared[e.id] ? t("viewPrep") : t("prepButton")}
                  </button>
                  {iv?.hasTranscript ? (
                    <button
                      type="button"
                      onClick={() => setTranscriptEntry(e)}
                      className="focus-ring mt-1.5 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-moss/40 bg-moss/5 text-sm font-semibold text-moss hover:bg-moss/10"
                    >
                      <FileText size={14} /> {t("transcriptReady")}
                    </button>
                  ) : iv?.status === "in_progress" ? (
                    // A LIVE call is a status, not an action: the old enabled button
                    // (label swap only) re-ran /create mid-call, revoking the candidate's
                    // session and emailing a second invite (voice-interview-runtime #2).
                    // Non-interactive live pill; /create's 409 guard backs it server-side.
                    <span
                      role="status"
                      className="mt-1.5 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-coral/40 bg-coral/5 text-sm font-semibold text-coral"
                    >
                      <span className="relative flex h-2 w-2" aria-hidden>
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-coral opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-coral" />
                      </span>
                      {t("interviewLive")}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startInterview(e)}
                      disabled={creatingIv === e.id}
                      className="focus-ring mt-1.5 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-stone-200 text-sm font-semibold text-ink hover:border-coral/40 disabled:opacity-50"
                    >
                      <Phone size={14} className="text-coral" />
                      {creatingIv === e.id ? t("opening") : t("startInterview")}
                    </button>
                  )}
                  <div className="mt-1.5 flex gap-1.5">
                    <button
                      type="button"
                      data-sim-click="confirm"
                      onClick={() => act(e, "approve_event")}
                      disabled={busy === e.id}
                      className="focus-ring inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-md bg-moss text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                    >
                      <Check size={14} /> {t("confirm")}
                    </button>
                    <button
                      type="button"
                      // Decline writes a TERMINAL `rejected` with no undo, and the X sits
                      // flush beside Confirm — a misclick permanently rejected the candidate.
                      // Gate it behind a confirm and label the icon-only button for SR users.
                      onClick={() => {
                        if (window.confirm(t("declineConfirm", { name: e.candidateLabel }))) {
                          act(e, "reject");
                        }
                      }}
                      disabled={busy === e.id}
                      aria-label={t("declineAria", { name: e.candidateLabel })}
                      className="focus-ring inline-flex h-8 items-center justify-center gap-1 rounded-md border border-stone-200 px-2.5 text-sm font-semibold text-coral hover:bg-coral/5 disabled:opacity-50"
                    >
                      <X size={14} aria-hidden />
                    </button>
                  </div>
                </motion.div>
              );
            })}
            </AnimatePresence>
            {calendarEntries.length === 0 ? null : selected ? (
              <p className="px-1 text-sm text-steel">
                {t.rich("clickToMove", {
                  name: selected.candidateLabel,
                  b: (chunks) => <span className="font-semibold text-ink">{chunks}</span>,
                })}
              </p>
            ) : (
              <p className="px-1 text-sm text-steel">{t("selectCandidate")}</p>
            )}

            {interviewedEntries.length ? (
              <div className="mt-3 space-y-2">
                <h3 className="text-meta uppercase tracking-wide text-steel">
                  {t("interviewed")} <span className="text-moss">· {interviewedEntries.length}</span>
                </h3>
                {interviewedEntries.map((e) => {
                  // No voice transcript → the round was run by a recruiter (the saved
                  // human scorecard is what admitted the card to this list).
                  const humanLed = !interviews[e.id]?.hasTranscript;
                  return (
                    <div key={e.id} className="rounded-lg border border-stone-200 bg-white p-2.5 shadow-panel">
                      <div className="flex w-full items-start gap-2">
                        <CandidateCardHeader
                          entry={e}
                          trailing={
                            humanLed ? (
                              <span className="rounded bg-paper px-1.5 py-0.5 text-meta font-semibold uppercase tracking-wide text-steel">
                                {t("humanLedChip")}
                              </span>
                            ) : undefined
                          }
                        />
                      </div>
                      {prepared[e.id]?.interviewer ? (
                        <p className="mt-1.5 flex items-center gap-1 truncate text-meta text-steel" title={t("interviewerTitle", { name: prepared[e.id]!.interviewer! })}>
                          <UserRound size={11} className="shrink-0 text-coral" /> {prepared[e.id]!.interviewer}
                        </p>
                      ) : null}
                      {humanLed ? null : (
                        <button
                          type="button"
                          onClick={() => setTranscriptEntry(e)}
                          className="focus-ring mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-moss/40 bg-moss/5 text-sm font-semibold text-moss hover:bg-moss/10"
                        >
                          <FileText size={14} /> {t("viewTranscriptScorecard")}
                        </button>
                      )}
                      {/* The prep modal stays reachable after the round completes — it is
                          the ONLY surface for the interviewer's notes and the human
                          scorecard (interview-prep-rubric #2). */}
                      <button
                        type="button"
                        onClick={() => setPrepEntry(e)}
                        className={`focus-ring ${humanLed ? "mt-2" : "mt-1.5"} inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-stone-200 text-sm font-semibold text-ink hover:border-coral/40`}
                      >
                        <ClipboardList size={14} className="text-coral" /> {t("prepScorecard")}
                      </button>
                      {/* Reverse handoff (Schedule → Decisions): the finished
                          interview's scorecard_review gate lives on Decisions —
                          pull the recruiter there, scoped to this role. */}
                      <button
                        type="button"
                        onClick={() =>
                          router.push(
                            buildUrl({ tab: "decisions", ...clearedTabScopedParams(), job: e.jobId }, search.toString())
                          )
                        }
                        className="focus-ring mt-1.5 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-stone-200 text-sm font-semibold text-ink hover:border-coral/40"
                      >
                        {t("reviewScorecard")} <ArrowRight size={13} aria-hidden />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </aside>
        </div>
      )}

      {prepEntry ? (
        <InterviewPrepModal
          entry={prepEntry}
          onClose={() => {
            setPrepEntry(null);
            // A verdict saved inside the modal may have gated the entry to
            // scorecard_review (DEC1) — reload so the card moves to "Interviewed"
            // instead of lingering in the calendar list with stale actions.
            load();
          }}
        />
      ) : null}
      {transcriptEntry ? <InterviewTranscriptModal entry={transcriptEntry} onClose={() => setTranscriptEntry(null)} /> : null}
    </div>
  );
}
