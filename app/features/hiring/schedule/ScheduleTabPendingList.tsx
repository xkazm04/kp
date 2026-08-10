"use client";

// The "pending interviews" aside list on ScheduleTab: one animated card per
// awaiting-slot candidate, with prep/transcript/start-interview/confirm-decline
// actions. Split out of ScheduleTab.tsx to keep the tab file under the
// 200-line cap.

import { AnimatePresence, motion, type TargetAndTransition } from "framer-motion";
import { Check, ClipboardList, FileText, History, Phone, UserRound, X } from "lucide-react";
import type { useTranslations } from "next-intl";
import { CandidateCardHeader } from "./ScheduleCandidateCardHeader";
import type { SchedEntry } from "./ScheduleTypes";
import type { IvStatus } from "./useScheduleTab";

export function ScheduleTabPendingList({
  t,
  calendarEntries,
  picks,
  slotLabel,
  selectedId,
  onSelect,
  interviews,
  prepared,
  busy,
  creatingIv,
  lastDir,
  reduced,
  cardExit,
  onPrep,
  onTranscript,
  onStartInterview,
  onAct,
}: {
  t: ReturnType<typeof useTranslations<"scheduleTab">>;
  calendarEntries: SchedEntry[];
  picks: Record<string, string>;
  slotLabel: (slot: string) => string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  interviews: Record<string, IvStatus>;
  prepared: Record<string, { createdAt: string; interviewer: string | null; hasHumanScorecard: boolean; stale: boolean }>;
  busy: string | null;
  creatingIv: string | null;
  lastDir: "confirm" | "decline";
  reduced: boolean;
  cardExit: (dir: "confirm" | "decline") => TargetAndTransition;
  onPrep: (e: SchedEntry) => void;
  onTranscript: (e: SchedEntry) => void;
  onStartInterview: (e: SchedEntry) => void;
  onAct: (e: SchedEntry, action: "approve_event" | "reject") => void;
}) {
  return (
    <>
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
              <button type="button" onClick={() => onSelect(e.id)} className="focus-ring flex w-full items-start gap-2 text-left">
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
              {prepared[e.id]?.stale ? (
                <p className="mt-1.5 flex items-center gap-1 text-meta font-semibold text-amber-800" title={t("prepStaleTitle")}>
                  <History size={11} className="shrink-0" aria-hidden /> {t("prepStale")}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => onPrep(e)}
                className="focus-ring mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-stone-200 text-sm font-semibold text-ink hover:border-coral/40"
              >
                <ClipboardList size={14} className="text-coral" />
                {prepared[e.id] ? t("viewPrep") : t("prepButton")}
              </button>
              {iv?.hasTranscript ? (
                <button
                  type="button"
                  onClick={() => onTranscript(e)}
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
                  onClick={() => onStartInterview(e)}
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
                  onClick={() => onAct(e, "approve_event")}
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
                      onAct(e, "reject");
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
    </>
  );
}
