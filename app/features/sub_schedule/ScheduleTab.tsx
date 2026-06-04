"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion, type TargetAndTransition } from "framer-motion";
import { Calendar, Check, ClipboardList, FileText, Phone, X } from "lucide-react";
import { ScheduleCalendar } from "./ScheduleCalendar";
import { InterviewPrepModal } from "./InterviewPrepModal";
import { InterviewTranscriptModal } from "./InterviewTranscriptModal";
import { DEFAULT_SLOT, styleFor, type SchedEntry } from "./ScheduleTypes";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";

type IvStatus = { sessionId: string; status: string; hasTranscript: boolean; endedAt: string | null };

// Shared candidate summary used by both the Pending and Interviewed lists: the
// truncated label + job title + archetype dot/label on the left, and the score
// (plus any list-specific `trailing` node, e.g. the proposed slot chip) on the
// right. Keeps the two lists provably consistent — a tweak here changes both.
function CandidateCardHeader({ entry, trailing }: { entry: SchedEntry; trailing?: ReactNode }) {
  const s = styleFor(entry.archetype);
  return (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">{entry.candidateLabel}</span>
        <span className="block truncate text-sm text-steel">{entry.jobTitle}</span>
        <span className="mt-1 inline-flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.bg}`} title={s.label} aria-hidden />
          <span className="text-meta uppercase tracking-wide text-steel">{s.label}</span>
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
  const [entries, setEntries] = useState<SchedEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [prepEntry, setPrepEntry] = useState<SchedEntry | null>(null);
  const [prepared, setPrepared] = useState<Record<string, string>>({});
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
    fetch("/api/pipeline")
      .then((r) => r.json())
      .then((p) => {
        if (p.error) throw new Error(p.error);
        const all = (p.entries as SchedEntry[]) ?? [];
        // Awaiting-slot candidates (the calendar) PLUS those already voice-interviewed
        // (now at scorecard_review) so a finished interview stays visible with its transcript.
        const sched = all.filter(
          (e) => (e.approvalKind === "calendar" || e.approvalKind === "scorecard_review") && e.status === "active"
        );
        setEntries(sched);
        setPicks(
          Object.fromEntries(
            sched.filter((e) => e.approvalKind === "calendar").map((e) => [e.id, e.approvalDetail || DEFAULT_SLOT])
          )
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load."));
  useEffect(() => {
    load();
  }, []);

  const pending = entries ?? [];
  const entryIds = pending.map((e) => e.id).join(",");
  const calendarEntries = pending.filter((e) => e.approvalKind === "calendar");
  // Interviewed = moved past scheduling but has a saved voice transcript.
  const interviewedEntries = pending.filter(
    (e) => e.approvalKind === "scorecard_review" && interviews[e.id]?.hasTranscript
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
      if (!r.ok) throw new Error(d.error || "Couldn't start the interview.");
      window.open(d.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the interview.");
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
      const r = await fetch(`/api/pipeline/${e.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, detail: action === "approve_event" ? picks[e.id] : undefined }),
      });
      if (!r.ok) throw new Error();
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
  const cardExit = (dir: "confirm" | "decline"): TargetAndTransition =>
    reduced
      ? { opacity: 0, transition: { duration: 0.12 } }
      : dir === "decline"
        ? { opacity: 0, x: -36, backgroundColor: "rgba(214,90,74,0.08)", borderColor: "#d65a4a", transition: { duration: 0.22, ease: "easeIn" } }
        : { opacity: 0, x: 36, backgroundColor: "rgba(82,107,79,0.08)", borderColor: "#526b4f", transition: { duration: 0.22, ease: "easeIn" } };

  return (
    <div data-sim="schedule" className="space-y-6">
      <header>
        <p className="text-meta uppercase text-coral">Decisions · Schedule</p>
        <h2 className="mt-1 font-serif text-display text-ink">Interview calendar</h2>
        <p className="mt-1 max-w-2xl text-body text-steel">
          Every candidate awaiting an interview slot, on one shared week. Select a candidate, click a cell to
          move their proposed time, then confirm — or decline to send them back.
        </p>
      </header>

      {error ? (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-base text-red-700">
          {error}
        </p>
      ) : entries == null ? (
        <p className="text-base text-steel">Loading…</p>
      ) : calendarEntries.length === 0 && interviewedEntries.length === 0 ? (
        <div className="rounded-lg border border-stone-200 bg-paper p-6 text-center">
          <Calendar className="mx-auto text-moss" size={28} />
          <p className="mt-2 text-base font-semibold text-ink">No interviews to schedule.</p>
          <p className="text-sm text-steel">Candidates appear here once they reach the scheduling step.</p>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
          <ScheduleCalendar
            entries={calendarEntries}
            picks={picks}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onPickSlot={pickSlot}
          />

          <aside className="space-y-2">
            <h3 className="text-meta uppercase tracking-wide text-steel">
              Pending interviews <span className="text-coral">· {calendarEntries.length}</span>
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
                      trailing={<span className="rounded bg-paper px-1.5 py-0.5 text-sm font-semibold text-ink">{picks[e.id]}</span>}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPrepEntry(e)}
                    className="focus-ring mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-stone-200 text-sm font-semibold text-ink hover:border-coral/40"
                  >
                    <ClipboardList size={14} className="text-coral" />
                    {prepared[e.id] ? "View interview prep" : "Interview prep"}
                  </button>
                  {iv?.hasTranscript ? (
                    <button
                      type="button"
                      onClick={() => setTranscriptEntry(e)}
                      className="focus-ring mt-1.5 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-moss/40 bg-moss/5 text-sm font-semibold text-moss hover:bg-moss/10"
                    >
                      <FileText size={14} /> Transcript ready · View
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startInterview(e)}
                      disabled={creatingIv === e.id}
                      className="focus-ring mt-1.5 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-stone-200 text-sm font-semibold text-ink hover:border-coral/40 disabled:opacity-50"
                    >
                      <Phone size={14} className="text-coral" />
                      {creatingIv === e.id ? "Opening…" : iv?.status === "in_progress" ? "Interview in progress" : "Start AI interview"}
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
                      <Check size={14} /> Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => act(e, "reject")}
                      disabled={busy === e.id}
                      className="focus-ring inline-flex h-8 items-center justify-center gap-1 rounded-md border border-stone-200 px-2.5 text-sm font-semibold text-coral hover:bg-coral/5 disabled:opacity-50"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </motion.div>
              );
            })}
            </AnimatePresence>
            {calendarEntries.length === 0 ? null : selected ? (
              <p className="px-1 text-sm text-steel">
                Click a calendar cell to move <span className="font-semibold text-ink">{selected.candidateLabel}</span>.
              </p>
            ) : (
              <p className="px-1 text-sm text-steel">Select a candidate to move their slot.</p>
            )}

            {interviewedEntries.length ? (
              <div className="mt-3 space-y-2">
                <h3 className="text-meta uppercase tracking-wide text-steel">
                  Interviewed <span className="text-moss">· {interviewedEntries.length}</span>
                </h3>
                {interviewedEntries.map((e) => {
                  return (
                    <div key={e.id} className="rounded-lg border border-stone-200 bg-white p-2.5 shadow-panel">
                      <div className="flex w-full items-start gap-2">
                        <CandidateCardHeader entry={e} />
                      </div>
                      <button
                        type="button"
                        onClick={() => setTranscriptEntry(e)}
                        className="focus-ring mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-moss/40 bg-moss/5 text-sm font-semibold text-moss hover:bg-moss/10"
                      >
                        <FileText size={14} /> View transcript &amp; scorecard
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </aside>
        </div>
      )}

      {prepEntry ? <InterviewPrepModal entry={prepEntry} onClose={() => setPrepEntry(null)} /> : null}
      {transcriptEntry ? <InterviewTranscriptModal entry={transcriptEntry} onClose={() => setTranscriptEntry(null)} /> : null}
    </div>
  );
}
