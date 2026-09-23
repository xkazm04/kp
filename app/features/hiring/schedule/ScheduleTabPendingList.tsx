"use client";

// The "pending interviews" aside list on ScheduleTab: one animated card per
// awaiting-slot candidate, with prep/transcript/start-interview/confirm-decline
// actions. Split out of ScheduleTab.tsx to keep the tab file under the
// 200-line cap.
//
// Each card's scheduling step follows its candidate's LIVE invite
// (schedulePendingCardState.ts, challenge-r02 slot B): send the link, a sent link's
// age, a fresh link for an expired or closed one, the candidate's proposed times
// accepted in place, a pointer at a stall. Confirm is the primary action only where
// a confirmed invite backs the cell; everywhere else the same control reads "Book
// suggested time" and sits second, so the guided simulation's click still resolves.

import { AnimatePresence, motion, type TargetAndTransition } from "framer-motion";
import { Check, ClipboardList, FileText, History, Link2, Phone, RotateCw, Send, UserRound, X } from "lucide-react";
import { useFormatter, type useTranslations } from "next-intl";
import { CandidateCardHeader } from "./ScheduleCandidateCardHeader";
import type { SchedEntry } from "./ScheduleTypes";
import { isSuggested, type SlotSource } from "./scheduleGridSeeds";
import type { IvStatus } from "./useScheduleTab";
import { bookControlFor, pendingCardState, type PendingCardState } from "./schedulePendingCardState";
import { BTN_AFFIRM, BTN_SECONDARY } from "@/app/_components/ui/recipes";

type Tr = ReturnType<typeof useTranslations<"scheduleTab">>;

// The line under the card header that says where scheduling stands, and the card's
// first action for that state. Nothing for a booked card: its "confirmed" chip says it.
function PendingCardNextStep({
  t,
  e,
  state,
  nowMs,
  busy,
  onSendLink,
  onCopyLink,
  onAcceptProposal,
}: {
  t: Tr;
  e: SchedEntry;
  state: PendingCardState;
  nowMs: number;
  busy: boolean;
  onSendLink: (e: SchedEntry) => void;
  onCopyLink: (token: string | null) => void;
  onAcceptProposal: (e: SchedEntry, token: string | null, slotAt: string) => void;
}) {
  const format = useFormatter();
  if (state.kind === "booked") return null;
  const line =
    state.kind === "no_link"
      ? t("cardState.noLink")
      : state.kind === "awaiting"
        ? t("cardState.awaiting", {
            when: state.sentAt && nowMs > 0 ? format.relativeTime(new Date(state.sentAt), nowMs) : "",
          })
        : state.kind === "expired"
          ? t("cardState.expired")
          : state.kind === "closed"
            ? state.closedReason === "no_show"
              ? t("cardState.noShow")
              : t("cardState.declined")
            : state.kind === "proposals"
              ? t("cardState.proposals", { count: state.proposals.length })
              : t("cardState.stuck");
  const wide = "mt-1.5 h-8 w-full justify-center text-sm";
  return (
    <div className="mt-2 border-t border-stone-200 pt-2">
      <p className={`text-meta ${state.kind === "stuck_no_slots" ? "font-semibold text-amber-800" : "text-steel"}`}>{line}</p>
      {state.primary === "send_link" || state.primary === "reinvite" ? (
        <button type="button" onClick={() => onSendLink(e)} disabled={busy} className={`${BTN_AFFIRM} ${wide}`}>
          {state.primary === "send_link" ? <Send size={14} aria-hidden /> : <RotateCw size={14} aria-hidden />}
          {state.primary === "send_link" ? t("sendLink.action") : t("cardState.reinvite")}
        </button>
      ) : state.primary === "copy_link" ? (
        <button type="button" onClick={() => onCopyLink(state.token)} className={`${BTN_SECONDARY} ${wide}`}>
          <Link2 size={14} aria-hidden /> {t("cardState.copyLink")}
        </button>
      ) : state.primary === "accept_proposal" ? (
        <div role="group" aria-label={t("lifecycle.proposalsGroupAria")} className="mt-1.5 flex flex-col gap-1">
          {state.proposals.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => onAcceptProposal(e, state.token, p.value)}
              disabled={busy}
              className={`${BTN_AFFIRM} h-8 w-full justify-center text-sm`}
            >
              <Check size={14} aria-hidden /> {t("lifecycle.acceptProposal", { time: p.label })}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ScheduleTabPendingList({
  t,
  calendarEntries,
  picks,
  pickSources,
  candidateZones,
  slotLabel,
  selectedId,
  onSelect,
  interviews,
  prepared,
  busy,
  creatingIv,
  actionError,
  lastDir,
  reduced,
  cardExit,
  onPrep,
  onTranscript,
  onStartInterview,
  onAct,
  cardStates,
  nowMs,
  onSendLink,
  onCopyLink,
  onAcceptProposal,
}: {
  t: Tr;
  calendarEntries: SchedEntry[];
  picks: Record<string, string>;
  // entry id → where that card's time came from; anything but "booked" is a guess.
  pickSources: Record<string, SlotSource>;
  // entry id → the candidate's own IANA zone, captured when they booked.
  candidateZones: Record<string, string>;
  slotLabel: (slot: string) => string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  interviews: Record<string, IvStatus>;
  prepared: Record<string, { createdAt: string; interviewer: string | null; hasHumanScorecard: boolean; stale: boolean }>;
  busy: string | null;
  creatingIv: string | null;
  // A refusal of THIS card's confirm/decline, rendered under its own actions —
  // see the note on `actionError` in useScheduleTab.ts for why it lives here
  // rather than in the tab-level banner or a toast.
  actionError: { entryId: string; message: string } | null;
  lastDir: "confirm" | "decline";
  reduced: boolean;
  cardExit: (dir: "confirm" | "decline") => TargetAndTransition;
  onPrep: (e: SchedEntry) => void;
  onTranscript: (e: SchedEntry) => void;
  // Absent when the workspace plan runs no AI round — the launcher is hidden.
  onStartInterview?: (e: SchedEntry) => void;
  onAct: (e: SchedEntry, action: "approve_event" | "reject") => void;
  // entry id -> the card's state from its candidate's live invite.
  cardStates: Record<string, PendingCardState>;
  // "Now" as of the last agenda change (a sent link's age is relative to it).
  nowMs: number;
  onSendLink: (e: SchedEntry) => void;
  onCopyLink: (token: string | null) => void;
  onAcceptProposal: (e: SchedEntry, token: string | null, slotAt: string) => void;
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
          // No resolved state yet (a card rendered before its first agenda read) reads
          // as "no link" - a suggestion, never a booking.
          const state = cardStates[e.id] ?? pendingCardState(e, null, pickSources[e.id], nowMs);
          const book = bookControlFor(state);
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
                  trailing={
                    <span className="flex flex-col items-end gap-0.5">
                      <span className="rounded bg-paper px-1.5 py-0.5 text-sm font-semibold text-ink">{slotLabel(picks[e.id] ?? "")}</span>
                      {/* Provenance, in words. A time seeded from the legacy detail —
                          or from the flat "Tue 14:00" default — read exactly like one a
                          candidate had confirmed through their own link. */}
                      {isSuggested(pickSources[e.id]) ? (
                        <span className="rounded border border-dashed border-stone-300 px-1 py-px text-meta text-steel">
                          {t("slotSuggested")}
                        </span>
                      ) : (
                        <span className="rounded bg-moss/10 px-1 py-px text-meta font-semibold text-moss">{t("slotConfirmed")}</span>
                      )}
                    </span>
                  }
                />
              </button>
              {candidateZones[e.id] ? (
                // Where the candidate actually is. Stored at confirm time since
                // idea-b51106df and rendered only on the agenda row until now, so a
                // recruiter reading this list could not see that this 14:00 is the
                // middle of the candidate's night.
                <p className="mt-1.5 truncate text-meta text-steel">{t("candidateZone", { zone: candidateZones[e.id]! })}</p>
              ) : null}
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
              ) : onStartInterview ? (
                <button
                  type="button"
                  onClick={() => onStartInterview(e)}
                  disabled={creatingIv === e.id}
                  className="focus-ring mt-1.5 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-stone-200 text-sm font-semibold text-ink hover:border-coral/40 disabled:opacity-50"
                >
                  <Phone size={14} className="text-coral" />
                  {creatingIv === e.id ? t("opening") : t("startInterview")}
                </button>
              ) : null}
              <PendingCardNextStep
                t={t}
                e={e}
                state={state}
                nowMs={nowMs}
                busy={busy === e.id}
                onSendLink={onSendLink}
                onCopyLink={onCopyLink}
                onAcceptProposal={onAcceptProposal}
              />
              <div className="mt-1.5 flex gap-1.5">
                {/* ONE book control for every state. A confirmed cell makes it the
                    primary Confirm; anywhere else it books a SUGGESTED time (the route
                    mails the candidate nothing), so it is labelled so and sits second. */}
                <button
                  type="button"
                  data-sim-click="confirm"
                  onClick={() => onAct(e, "approve_event")}
                  disabled={busy === e.id}
                  title={book.label === "bookSuggested" ? t("cardState.bookSuggestedTitle", { slot: slotLabel(picks[e.id] ?? "") }) : undefined}
                  className={`${book.emphasis === "primary" ? BTN_AFFIRM : BTN_SECONDARY} h-8 flex-1 justify-center text-sm`}
                >
                  <Check size={14} aria-hidden /> {book.label === "confirm" ? t("confirm") : t("cardState.bookSuggested")}
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
              {actionError?.entryId === e.id ? (
                <p role="alert" className="mt-1.5 rounded bg-red-50 px-1.5 py-1 text-meta font-semibold text-red-700">
                  {actionError.message}
                </p>
              ) : null}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </>
  );
}
