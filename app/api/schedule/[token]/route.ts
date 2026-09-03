import { NextRequest } from "next/server";
import { actOnPipelineEntry, getPipelineEntry } from "@/app/_lib/db/pipeline";
import { dispatchInterviewConfirmation, dispatchInterviewerBrief } from "@/app/_lib/comms-dispatch";
import { deliveryClaim, type DeliveryClaim } from "@/app/_lib/comms-truth";
import { isRelayConfigured } from "@/app/_lib/comms-relay";
import { getInterviewPrep } from "@/app/_lib/interview-prep";
import {
  bookedSlots,
  cancelAttendance,
  confirmAttendance,
  confirmScheduleInvite,
  declineScheduleInvite,
  flagScheduleInviteNeedsMoreSlots,
  getScheduleInviteByToken,
  markScheduleInviteNeedsReconcile,
  MAX_RESCHEDULES,
  rescheduleScheduleInvite,
  setScheduleInviteProposals,
  isTerminalScheduleInviteStatus,
  type ScheduleInvite,
} from "@/app/_lib/schedule-store";
import { offeredSlotFor, isScheduleInviteExpired, validateProposedSlots } from "@/app/_lib/schedule-slots";
import { proposeFreeSlots, slotStillFree } from "@/app/_lib/calendar/available-slots";
import { removeInterviewEvent, syncInterviewEvent } from "@/app/_lib/calendar/event-sync";
import { isValidTimeZone } from "@/app/_lib/timezone";
import { logScheduleNoSlots, logScheduleReconcile } from "@/app/_lib/logger";
import { jsonOk, jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { isShortNoticeBooking } from "@/app/_lib/interview-reminder-policy";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { pinLinkLocale } from "@/app/_lib/candidate-link-locale";
import { resolveCommsLocale } from "@/app/_lib/comms-locale";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";


// Candidate-facing projection of an invite (idea-69d1e4fd). The route used to
// return the WHOLE ScheduleInvite row to the public token holder — including
// entryId (an internal pipeline_entries primary key, the same IDOR handle
// POST /api/schedule/invite and other entry-keyed flows accept) and
// reconcileReason (raw internal error text persisted by the reconcile flag).
// SchedulePicker only consumes these five fields; nothing else belongs on the
// public wire.
function publicInviteView(invite: ScheduleInvite) {
  return {
    candidateLabel: invite.candidateLabel,
    jobTitle: invite.jobTitle,
    status: invite.status,
    slot: invite.slot,
    // The ISO slot time — the candidate's OWN confirmed booking, surfaced so the
    // booked card can offer an "Add to calendar" (.ics) download (SCH1). Not an
    // internal handle (unlike entryId/reconcileReason, which stay off the wire).
    slotAt: invite.slotAt,
    durationMin: invite.durationMin,
    // The candidate's RSVP on their booking (idea-87af39c5), so the booked card
    // can show "Attendance confirmed" vs the confirm/cancel actions. Not an
    // internal handle — safe on the public wire.
    attendanceStatus: invite.attendanceStatus,
    // The interview join link, when the recruiter has set one — so the candidate's
    // booked card can show a "Join" button and bake it into their calendar event.
    meetingUrl: invite.meetingUrl,
    // "Propose your own times" escalation state (server-authored, safe on the wire):
    // 'pending' after the candidate suggests times (page shows "waiting on the team"),
    // 'declined' when the recruiter couldn't accommodate (honest "they'll reach out").
    proposalStatus: invite.proposalStatus,
    proposals: invite.proposals,
  };
}

// The candidate's own read is the EXPENSIVE call on this route: it runs proposeFreeSlots,
// which fans out to the interviewer's connected Google calendar (free/busy) on every hit.
// It was the only public token READ in the product with no limiter — /api/status/[token],
// /api/offer/[token] and this route's own POST all have one — so an unauthenticated holder
// of one link could drive unbounded third-party calendar traffic from a loop.
//
// Same budget and shape as the status page's read (60/min per client AND token): the picker
// fetches once on load and re-fetches after a booking, a 409 and an RSVP cancel, so honest
// use sits an order of magnitude below it, and the per-token half of the key keeps one
// scraped link from throttling a different candidate behind the same NAT.
const SCHEDULE_READ_RATE_LIMIT = { limit: 60, windowMs: 60_000 };

// GET → candidate-facing data: the invite + proposed slots.
export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!rateLimit(`sched-read:${clientIpFrom(request.headers)}:${token}`, SCHEDULE_READ_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  const invite = getScheduleInviteByToken(token);
  if (!invite) return jsonRefusal("SCHEDULE_LINK_NOT_FOUND", 404);
  // Dead-capability gate (Direction 1): a link that aged out unbooked ('expired',
  // derived), or one the state machine closed ('declined' / 'no_show'), offers no
  // slots. The candidate page renders a localized terminal card from `closed` — the
  // same shape as the "all taken" card — instead of a live picker that can't book.
  const expired = isScheduleInviteExpired(invite);
  const closed = expired || isTerminalScheduleInviteStatus(invite.status);
  if (closed) {
    return jsonOk({
      invite: publicInviteView(invite),
      slots: [],
      noSlots: false,
      canReschedule: false,
      calendarChecked: false,
      closed: true,
      closedReason: expired ? "expired" : invite.status,
    });
  }
  // A confirmed candidate may still self-reschedule (under the cap) — offer slots
  // in that case too, not just for a pending first booking. proposeSlots excludes
  // already-booked times, including this candidate's current one (they're moving
  // away from it). The cap stops the "change time" affordance from churning.
  const canReschedule = invite.status === "confirmed" && invite.rescheduleCount < MAX_RESCHEDULES;
  // A confirmed candidate who has spent every self-reschedule is stuck (the "change
  // time" affordance is gone). This flags exactly that dead-end so the page can offer
  // the "propose your own times" escalation instead of the old "reply to your email".
  const rescheduleCapReached = invite.status === "confirmed" && invite.rescheduleCount >= MAX_RESCHEDULES;
  // Per-team calendar: only this invite's own team's confirmed slots block a time.
  // W1.4 — the offered times now also respect the team's connected calendar, so a
  // candidate cannot pick an hour the interviewer is already booked for. Degrades to the
  // pre-integration list on any calendar failure (available-slots.ts).
  const proposed =
    invite.status !== "confirmed" || canReschedule
      // The interview's REAL length drives the conflict check. This call omitted `minutes`,
      // so every interview was checked as 45 regardless of durationMin — a 90-minute slot
      // had its second half compared against nothing and could be offered over a meeting.
      // A legacy invite with a null durationMin still gets the documented default.
      ? await proposeFreeSlots(
          bookedSlots(invite.workspaceId),
          invite.workspaceId,
          undefined,
          invite.durationMin ?? undefined
        )
      : { slots: [], calendarChecked: false, calendarStatus: "not_connected" as const, droppedForConflict: 0 };
  const slots = proposed.slots;
  // The busiest-calendar edge (idea-5df8e10f): a pending invite whose entire
  // proposal horizon is already booked yields zero slots. Rather than handing
  // the candidate a silent dead-end, flag the invite so the recruiter can open
  // more times — the detection happens server-side on the read that surfaces the
  // emptiness, so the booking can't stall waiting on a candidate action. The
  // flag is idempotent and logs/counts only on the 0→1 transition, so a page
  // refresh doesn't re-alert; flagging is best-effort and never blocks the read.
  const noSlots = invite.status !== "confirmed" && slots.length === 0;
  if (noSlots) {
    try {
      if (flagScheduleInviteNeedsMoreSlots(token)) {
        await logScheduleNoSlots({ token, entry_id: invite.entryId });
      }
    } catch {
      /* flagging is best-effort — never block the candidate's read */
    }
  }
  // Whether these times were actually checked against the interviewer's calendar — the
  // engine has always known (fetchBusy separates null "unknown" from [] "checked, clear"),
  // and this route dropped it entirely, so a candidate could not tell a calendar-confirmed
  // time from one offered blind during a Google outage.
  //
  // ONE BIT ONLY, deliberately. `calendarStatus` (which of not_connected / unavailable) and
  // `droppedForConflict` (how many times the interviewer's calendar removed) are both
  // statements about the INTERVIEWER's calendar, and this is the public token wire — the
  // same doctrine that keeps entryId and reconcileReason off publicInviteView. The
  // candidate learns whether the times were checked, never anything about the busy behind
  // them; the recruiter route (workspace-authenticated) carries the full three-state.
  return jsonOk({
    invite: publicInviteView(invite),
    slots,
    noSlots,
    canReschedule,
    rescheduleCapReached,
    calendarChecked: proposed.calendarChecked,
  });
}

// POST → candidate confirms a slot: record it, set it on the pipeline entry
// (approve_event honors the chosen slot), and send a confirmation + reminder.
export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    // Side-effect-bearing public endpoint (a confirm dispatches candidate
    // email) — throttle per caller+token (idea-3e49abaf).
    if (!rateLimit(`sched:${clientIpFrom(request.headers)}:${token}`, { limit: 10, windowMs: 60_000 })) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    const body = (await request.json().catch(() => ({}))) as {
      slot?: string;
      slotAt?: string;
      reschedule?: boolean;
      tz?: string;
      rsvp?: "confirm" | "cancel";
      // Direction 1 — the candidate withdraws from the interview entirely (a terminal
      // 'declined' fate), distinct from an rsvp cancel that frees the slot for re-booking.
      withdraw?: boolean;
      // "Propose your own times" escalation: 1–MAX_PROPOSALS candidate-suggested ISO
      // instants, validated server-side (proposedSlotFor) before they land on the invite.
      propose?: unknown;
    };
    // The candidate's IANA timezone (idea-b51106df), captured so the recruiter
    // agenda can show a cross-border booking in the candidate's real local time.
    // Validated against the runtime's zone table — a spoofed/unknown value is
    // dropped to null rather than stored, so it can never make Intl throw later.
    const candidateTz = isValidTimeZone(body.tz) ? body.tz : null;
    const invite = getScheduleInviteByToken(token);
    if (!invite) return jsonRefusal("SCHEDULE_LINK_NOT_FOUND", 404);

    // Dead-capability gate (Direction 1): a stale tab can still POST after the link
    // aged out ('expired') or the state machine closed it ('declined' / 'no_show').
    // Refuse every mutation (book / reschedule / RSVP) with 410 Gone rather than let
    // a closed link book a slot. The GET already renders the terminal card, so this
    // is the server-side safety net; the picker maps the 410 to localized copy.
    if (isScheduleInviteExpired(invite) || isTerminalScheduleInviteStatus(invite.status)) {
      return jsonRefusal("SCHEDULE_LINK_CLOSED", 410);
    }

    // WITHDRAW (Direction 1): the candidate declines the interview entirely — a
    // terminal 'declined' fate, reachable from a pending or confirmed invite. Distinct
    // from an rsvp cancel (which frees the slot and re-opens the invite for re-booking).
    // The linked pipeline entry is intentionally left at its stage: a withdrawal is
    // surfaced to the recruiter, not silently regressed.
    if (body.withdraw === true) {
      const declined = declineScheduleInvite(token);
      if (!declined) return jsonRefusal("SCHEDULE_LINK_NOT_FOUND", 404);
      // The interview is off — take it off the interviewer's calendar too, or the
      // recruiter keeps a block of time for a candidate who withdrew. `invite` (the
      // PRE-decline row) still carries the event id; declineScheduleInvite clears the
      // slot, not the calendar handle. Best-effort: a failed delete is recorded as
      // 'orphaned' and never turns a withdrawal into an error.
      await removeInterviewEvent(invite);
      return jsonOk({ ok: true, invite: publicInviteView(declined), withdrawn: true });
    }

    // PROPOSE YOUR OWN TIMES: a STUCK candidate escalates with 1–MAX_PROPOSALS concrete
    // times. Only reachable from the two genuine dead-ends — a pending invite whose
    // whole horizon is booked, or a confirmed invite past the self-reschedule cap — so a
    // candidate with open slots is steered back to the picker rather than into a manual
    // loop. The instants cross a trust boundary: validateProposedSlots re-authors every
    // label server-side and refuses anything out of hours/past/off-horizon.
    if (Array.isArray(body.propose)) {
      // A rejected/declined candidate can't escalate (mirrors the confirm/rsvp guard).
      if (invite.entryId) {
        const linkedEntry = getPipelineEntry(invite.entryId, invite.workspaceId);
        if (linkedEntry && linkedEntry.status !== "active") {
          return jsonRefusal("SCHEDULE_INTERVIEW_UNAVAILABLE", 409);
        }
      }
      // "Stuck" MUST be decided by the same slot engine the GET renders from. This used
      // the bare proposeSlots (kp bookings only), while the GET that offers the escalation
      // uses proposeFreeSlots (kp bookings AND the interviewer's connected calendar, over
      // the interview's REAL length). A horizon emptied by the calendar rather than by kp
      // therefore showed the candidate "propose your own times", then answered their
      // submission with "there are still open times — pick one from the list" over an empty
      // picker: a closed loop with no way out. Same call shape as the GET, so the two
      // readings of "no slots left" cannot disagree; on a calendar outage both degrade to
      // the identical pre-integration list, so the unknown case behaves exactly as before.
      const stuckPending =
        invite.status === "pending" &&
        (
          await proposeFreeSlots(
            bookedSlots(invite.workspaceId),
            invite.workspaceId,
            undefined,
            invite.durationMin ?? undefined
          )
        ).slots.length === 0;
      const stuckCapped = invite.status === "confirmed" && invite.rescheduleCount >= MAX_RESCHEDULES;
      if (!stuckPending && !stuckCapped) {
        return jsonRefusal("SCHEDULE_SLOTS_STILL_OPEN", 409);
      }
      const proposed = validateProposedSlots(body.propose);
      if (!proposed) {
        return jsonRefusal("SCHEDULE_PROPOSALS_INVALID", 400);
      }
      const saved = setScheduleInviteProposals(token, proposed);
      if (!saved) return jsonRefusal("SCHEDULE_LINK_NOT_FOUND", 404);
      return jsonOk({ ok: true, invite: publicInviteView(saved), proposed: true });
    }

    // RSVP (idea-87af39c5): a confirmed candidate confirms attendance or cancels,
    // reusing this token. Handled BEFORE the idempotent re-confirm echo so it isn't
    // swallowed. A cancel frees the slot and re-opens the invite for re-booking; the
    // entry-active guard (below, shared) also applies — a rejected/declined candidate
    // can't RSVP.
    if (body.rsvp === "confirm" || body.rsvp === "cancel") {
      if (invite.status !== "confirmed") {
        return jsonRefusal("SCHEDULE_NO_BOOKING_YET", 409);
      }
      if (invite.entryId) {
        const linkedEntry = getPipelineEntry(invite.entryId, invite.workspaceId);
        if (linkedEntry && linkedEntry.status !== "active") {
          return jsonRefusal("SCHEDULE_INTERVIEW_UNAVAILABLE", 409);
        }
      }
      const updated = body.rsvp === "confirm" ? confirmAttendance(token) : cancelAttendance(token);
      if (!updated) return jsonRefusal("SCHEDULE_LINK_NOT_FOUND", 404);
      // "I can't make it" frees the slot in kp; free it on the calendar too. A later
      // re-booking on this same invite creates a fresh event (the id is cleared with
      // the deletion), so the two can't drift into a ghost at the abandoned time.
      if (body.rsvp === "cancel") await removeInterviewEvent(invite);
      return jsonOk({ ok: true, invite: publicInviteView(updated), rsvp: body.rsvp });
    }

    // A confirmed invite hit again WITHOUT a reschedule intent is an idempotent
    // re-confirm (double-submit / stale tab) — just echo the booking. A reschedule
    // (body.reschedule) falls through to the move path below.
    if (invite.status === "confirmed" && !body.reschedule) {
      return jsonOk({ ok: true, invite: publicInviteView(invite) });
    }

    // Don't let a still-valid token book OR move an interview for a candidate
    // rejected/declined since the link was minted (status goes terminal; Hired
    // keeps 'active'). approve_event guards this server-side too (defense-in-depth).
    // Applies to both a first confirm and a reschedule.
    //
    // TENANCY: the entry is looked up in the INVITE's workspace (this route is
    // token-authenticated, not session-authenticated, so there is no currentWorkspace()
    // to read). Every getPipelineEntry here used to omit it and fall back to
    // DEFAULT_WORKSPACE_ID, so for a non-default team the lookup returned null and this
    // guard — plus the propose/RSVP guards and the entry advance below — silently
    // no-op'd: a rejected candidate could still book.
    if (invite.entryId) {
      const linkedEntry = getPipelineEntry(invite.entryId, invite.workspaceId);
      if (linkedEntry && linkedEntry.status !== "active") {
        return jsonRefusal("SCHEDULE_INTERVIEW_UNAVAILABLE", 409);
      }
    }

    // Only a slot the server itself would offer is bookable (idea-e05aedfb):
    // the handler used to trust body.slot/body.slotAt verbatim, letting a token
    // holder book a 3am-Sunday/past time and inject arbitrary label text into
    // the confirmation + reminder EMAILS and the recruiter activity feed. The
    // submitted time is validated structurally and the label is RE-DERIVED
    // server-side — the client's body.slot is ignored entirely. Shared by confirm
    // and reschedule.
    const offered = offeredSlotFor(body.slotAt);
    if (!offered) {
      return jsonRefusal("SCHEDULE_SLOT_NOT_OFFERED", 400);
    }
    const slot = offered.label;

    // RE-CHECK THE CALENDAR AT THE MOMENT OF BOOKING. offeredSlotFor is a structural
    // match against what the server WOULD offer — it says nothing about what happened on
    // the interviewer's calendar since the page loaded. A slot that filled in that gap
    // (minutes for a fresh link, days for one mailed last week) booked straight into the
    // conflict, which is precisely the double-booking free/busy exists to prevent.
    //
    // UNKNOWN PROCEEDS. slotStillFree returns null when no calendar is connected or the
    // lookup failed, and that path books exactly as it did before this integration — an
    // outage must never block a booking (the seam's stated contract). Only a definite
    // "busy" refuses, and it refuses with the SAME 409 shape as a kp-side collision, so
    // the picker's existing handler refreshes the slot list and re-offers.
    const calendarFree = await slotStillFree(offered.value, invite.workspaceId, invite.durationMin ?? undefined);
    if (calendarFree === false) {
      return jsonRefusal("SCHEDULE_SLOT_TAKEN", 409, { invite: publicInviteView(invite) });
    }

    // Record the chosen slot on the linked pipeline entry and send the
    // confirmation. Shared by the first confirm and a reschedule so the
    // approve_event + dispatch + reconcile-on-failure handling can't drift between
    // them. Returns the TRUTHFUL delivery claim (REC-10): "sent" only for a
    // relayed 2xx, "queued" when no relay is configured (the row is a terminal
    // local-outbox record — the candidate page must not promise "we've sent a
    // confirmation"), "failed" when delivery dead-lettered/threw (worst for
    // short-notice bookings, which get no separate timed reminder).
    // approve_event records the slot WITHOUT regressing an entry already past
    // Interview, so a reschedule of an in-progress interview is safe.
    const recordBooking = async (booked: ScheduleInvite): Promise<DeliveryClaim> => {
      // No linked entry ⇒ nothing to confirm to — fall back to capability so the
      // page copy stays consistent with what a dispatch WOULD have done.
      const blindClaim = deliveryClaim(isRelayConfigured());
      if (!invite.entryId) return blindClaim;
      const entry = getPipelineEntry(invite.entryId, invite.workspaceId);
      if (!entry) return blindClaim;
      try {
        // TENANCY: the advance runs in the INVITE's workspace — the very one the entry
        // was just read from on the line above. Omitted, it fell back to
        // DEFAULT_WORKSPACE_ID and actOnPipelineEntry's `WHERE id = ? AND workspace_id = ?`
        // matched nothing on any other team: the candidate booked a slot and got their
        // confirmation email while the recruiter's board never recorded the slot and never
        // advanced to Interview. Worse, a tenant miss RETURNS NULL rather than throwing, so
        // the catch below — the only thing that raises needs_reconcile — never fired and
        // the drift was invisible on both sides. `undefined` for opts keeps the human
        // actor / no-CAS default. (Token route: no session, so the invite is the authority.)
        const advanced = actOnPipelineEntry(entry.id, "approve_event", slot, undefined, invite.workspaceId);
        // A null return is the OTHER silent failure mode (the entry was deleted or went
        // terminal between the active-guard above and this write). Same user-visible drift
        // as a throw — a booked candidate whose card never moved — so it earns the same
        // reconcile flag instead of passing for a clean success.
        if (!advanced) {
          const reason = "pipeline entry did not advance (no matching active entry)";
          markScheduleInviteNeedsReconcile(token, reason);
          await logScheduleReconcile({ token, entry_id: entry.id, slot, error: reason });
        }
      } catch (advanceError) {
        // The slot is recorded and the candidate sees "booked", but the pipeline
        // entry didn't advance (stage gate not ready) — make the drift findable
        // rather than swallow it: flag the invite, count it, and log it.
        const reason = advanceError instanceof Error ? advanceError.message : String(advanceError);
        markScheduleInviteNeedsReconcile(token, reason);
        await logScheduleReconcile({ token, entry_id: entry.id, slot, error: reason });
      }
      try {
        const slotAtMs = booked.slotAt ? Date.parse(booked.slotAt) : NaN;
        const bookedAtMs = booked.confirmedAt ? Date.parse(booked.confirmedAt) : NaN;
        const shortNotice =
          !Number.isNaN(slotAtMs) && !Number.isNaN(bookedAtMs) && isShortNoticeBooking(slotAtMs, bookedAtMs);
        const confirmationStatus = await dispatchInterviewConfirmation(entry, slot, {
          shortNotice,
          durationMin: booked.durationMin,
          // The candidate's one durable way back to reschedule (SCH2) / .ics —
          // the picker page is gone once the tab closes.
          // Pinned to the candidate's own language, exactly like the invite that started
          // this thread: this ABSOLUTE link is opened from an email, where no NEXT_LOCALE
          // cookie exists, so unpinned it drops a Czech candidate on an English booking
          // page from a Czech letter (proxy.ts turns ?lang= back into the cookie). The
          // locale is the entry's own — the same resolution the letter itself uses.
          rescheduleLink: pinLinkLocale(
            `${publicBaseUrl(new URL(request.url).origin)}/schedule/${token}`,
            resolveCommsLocale(entry.locale, entry.workspaceId ?? undefined)
          ),
        });
        // Brief the assigned interviewer too (interview-prep #2). Best-effort: a
        // brief failure must never turn the candidate's confirmed booking into an
        // error, so it's isolated and only logged. dispatchInterviewerBrief is the
        // gatekeeper — it no-ops (or records interviewer_brief_skipped) when the
        // prep carries no interviewer / no deliverable address.
        try {
          const prep = getInterviewPrep(entry.id, entry.workspaceId);
          const p = (prep?.payload ?? {}) as { interviewer?: unknown; scenario?: unknown; focusAreas?: unknown; lang?: unknown };
          await dispatchInterviewerBrief(entry, slot, {
            interviewer: typeof p.interviewer === "string" ? p.interviewer : null,
            durationMin: booked.durationMin,
            slotAtIso: booked.slotAt,
            scenario: typeof p.scenario === "string" ? p.scenario : null,
            focusAreas: Array.isArray(p.focusAreas) ? p.focusAreas.filter((f): f is string => typeof f === "string") : null,
            lang: typeof p.lang === "string" ? p.lang : null,
          });
        } catch (briefError) {
          const reason = briefError instanceof Error ? briefError.message : String(briefError);
          await logScheduleReconcile({ token, entry_id: entry.id, slot, error: `interviewer brief failed: ${reason}` });
        }
        return deliveryClaim(isRelayConfigured(), confirmationStatus);
      } catch (dispatchError) {
        const reason = dispatchError instanceof Error ? dispatchError.message : String(dispatchError);
        markScheduleInviteNeedsReconcile(token, `confirmation email failed: ${reason}`);
        await logScheduleReconcile({ token, entry_id: entry.id, slot, error: `confirmation dispatch failed: ${reason}` });
        return "failed";
      }
    };

    // W1.4, second half — write the confirmed interview onto the team's connected
    // calendar (create on a first booking, UPDATE the same event on a reschedule, so an
    // interview never leaves a ghost at its old time). Deliberately OUTSIDE recordBooking
    // and after it: an invite with no linked entry still deserves its calendar entry, and
    // the candidate's confirmation email is the more important of the two side effects.
    // Best-effort by construction — syncInterviewEvent records its own outcome on the
    // invite and never throws, so a Google outage cannot half-commit a booking.
    const writeCalendarEvent = async (booked: ScheduleInvite): Promise<void> => {
      // TENANCY: the same workspace every other entry lookup in this handler uses (the
      // active-guard and recordBooking both read it off the invite). Omitted, this one
      // fell back to the default team and returned null for every other team, so the
      // calendar event was written WITHOUT the candidate as an attendee — the interviewer
      // got a block of time on their calendar and the candidate never got the invitation.
      const entry = invite.entryId ? getPipelineEntry(invite.entryId, invite.workspaceId) : null;
      await syncInterviewEvent(booked, {
        // The candidate joins the event as an attendee when we hold a real address;
        // `contact` also stores phone numbers, which event-sync filters out.
        attendeeEmail: entry?.contact ?? null,
        baseUrl: publicBaseUrl(new URL(request.url).origin),
      });
    };

    // RESCHEDULE — a confirmed candidate moving to a new time. Same collision
    // authority as confirm (rescheduleScheduleInvite's transaction), bounded by
    // MAX_RESCHEDULES, and the old slot is freed back into the pool.
    if (invite.status === "confirmed") {
      const moved = rescheduleScheduleInvite(token, slot, offered.value, candidateTz);
      if (!moved.ok) {
        if (moved.reason === "taken") {
          return jsonRefusal("SCHEDULE_SLOT_TAKEN", 409, { invite: moved.invite ? publicInviteView(moved.invite) : null });
        }
        if (moved.reason === "limit") {
          return jsonRefusal("SCHEDULE_RESCHEDULE_LIMIT", 409);
        }
        return jsonRefusal("SCHEDULE_LINK_NOT_FOUND", 404);
      }
      const confirmationDelivery = await recordBooking(moved.invite);
      await writeCalendarEvent(moved.invite);
      return jsonOk({
        ok: true,
        invite: publicInviteView(moved.invite),
        // Legacy boolean kept for older clients; `confirmationDelivery` is the
        // honest three-state the picker copy keys off (REC-10).
        confirmationSent: confirmationDelivery !== "failed",
        confirmationDelivery,
        rescheduled: true,
      });
    }

    // FIRST CONFIRM — a pending invite booking its slot.
    const result = confirmScheduleInvite(token, slot, offered.value, candidateTz);
    if (!result.ok) {
      if (result.reason === "taken") {
        // Another candidate confirmed this exact time between page load and submit.
        return jsonRefusal("SCHEDULE_SLOT_TAKEN", 409, { invite: result.invite ? publicInviteView(result.invite) : null });
      }
      return jsonRefusal("SCHEDULE_LINK_NOT_FOUND", 404);
    }
    const confirmationDelivery = await recordBooking(result.invite);
    await writeCalendarEvent(result.invite);
    return jsonOk({
      ok: true,
      invite: publicInviteView(result.invite),
      confirmationSent: confirmationDelivery !== "failed",
      confirmationDelivery,
    });
  } catch (error) {
    // Raw err.message would surface SQLite/dispatch internals on a public
    // token route — same hygiene as the pipeline/interview routes.
    return safeJsonError(error, "api:schedule:confirm", "SCHEDULE_CONFIRM_FAILED");
  }
}
