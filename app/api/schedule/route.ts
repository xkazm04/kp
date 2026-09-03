import { NextResponse } from "next/server";
import {
  bookedSlots,
  cancelAttendance,
  confirmScheduleInvite,
  createScheduleInvite,
  declineScheduleInviteProposals,
  getScheduleInviteByToken,
  listScheduleInvites,
  markScheduleInviteNeedsReconcile,
  markScheduleInviteNoShow,
  rescheduleScheduleInvite,
  resolveScheduleInviteReconcile,
  setScheduleInviteMeetingUrl,
  type ScheduleInvite,
} from "@/app/_lib/schedule-store";
// Slice, not the `./db` barrel — see the note in app/_lib/llm-config.ts.
import { actOnPipelineEntry, getPipelineEntry } from "@/app/_lib/db/pipeline";
import { plannedInterviewMinutes } from "@/app/_lib/interview-planned-minutes";
import { dateSlotToIso, gridSlotToIso, hourBucketKey, INTERVIEW_TZ, offeredSlotFor, proposedSlotFor, proposeSlots, scheduledSealOutcome } from "@/app/_lib/schedule-slots";
import { proposeFreeSlots, slotStillFree } from "@/app/_lib/calendar/available-slots";
import { removeInterviewEvent, syncInterviewEvent } from "@/app/_lib/calendar/event-sync";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { sealDecisionSafe } from "@/app/_lib/decision-record-store";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { jsonOk, jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";


// W6-3 (SCH1) — the recruiter's read over the invite lifecycle. The store
// deliberately persists operator flags ("recruiter must open more times",
// "booked but the pipeline didn't advance") that previously terminated in a
// server console; this serves them to the Schedule tab's lifecycle panel
// along with the booked agenda and un-booked invites.
//
// `?slots=1` (Direction 2) returns the offered reschedule slots for THIS team's
// calendar — the recruiter's reschedule control picks from the same collision-aware
// offered-slot mechanism the candidate picker uses.
export async function GET(request: Request) {
  try {
    const ws = await currentWorkspace();
    const params = new URL(request.url).searchParams;
    if (params.has("slots")) {
      // The REAL length of the interview being moved, not a blanket 45. proposeFreeSlots
      // has always accepted `minutes` and this call site never fed it, so a 90-minute
      // interview had its second half conflict-checked against nothing — the calendar was
      // asked about 10:00–10:45 and the 10:45–11:30 half booked over whatever was there.
      // The invite is named by the caller (the reschedule control knows its token); an
      // absent/foreign token or a legacy null durationMin falls back to the default.
      const forInvite = params.get("token") ? getScheduleInviteByToken(params.get("token")!) : null;
      const minutes =
        forInvite && forInvite.workspaceId === ws ? (forInvite.durationMin ?? undefined) : undefined;
      // W1.4 — also skips times the connected calendar is busy for. Degrades to the
      // pre-integration list when no calendar is connected or the lookup fails, so the
      // reschedule control never goes dark because Google did.
      const proposed = await proposeFreeSlots(bookedSlots(ws), ws, undefined, minutes);
      return NextResponse.json({
        slots: proposed.slots,
        calendarChecked: proposed.calendarChecked,
        // The honest three-state (checked / not_connected / unavailable). The boolean
        // above collapsed an outage, a revoked grant and a genuinely clear calendar into
        // one indistinguishable "false", and the reschedule picker rendered none of it.
        calendarStatus: proposed.calendarStatus,
        droppedForConflict: proposed.droppedForConflict,
      });
    }
    // The zone every time on this surface is expressed in. The recruiter grid
    // renders wall-clock cells with no zone marker anywhere, and INTERVIEW_TZ is a
    // SERVER env var (KP_INTERVIEW_TZ) — a client bundle reading it would silently
    // report the "Europe/Prague" default on an install that configured something
    // else, which is worse than saying nothing. So the server states it.
    return NextResponse.json({ invites: listScheduleInvites(200, ws), interviewTz: INTERVIEW_TZ });
  } catch (error) {
    return safeJsonError(error, "api:schedule", "SCHEDULE_LOOKUP_FAILED");
  }
}

// POST → recruiter-side invite control (Direction 2). The recruiter could only edit
// a meeting URL before; red needs_reconcile rows had no in-app repair, a no-show
// vanished, and there was no way to cancel or move a booking. These four actions
// layer on the SAME store primitives the candidate token flow uses (cancelAttendance,
// rescheduleScheduleInvite, markScheduleInviteNoShow) so the collision authority and
// reminder-cycle reset can't drift. Workspace-scoped (a recruiter only touches their
// own team's invites); the two outcome-bearing actions seal a decision record.
export async function POST(request: Request) {
  try {
    if (!rateLimit(`sched-manage:${clientIpFrom(request.headers)}`, { limit: 60, windowMs: 60_000 })) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    const ws = await currentWorkspace();
    const body = (await request.json().catch(() => ({}))) as {
      token?: string;
      action?: string;
      slotAt?: string;
      entryId?: string;
      gridSlot?: string;
      dateSlot?: string;
    };
    if (!body.action) {
      return jsonRefusal("SCHEDULE_ACTION_REQUIRED", 400);
    }
    // W1.4, second half — every recruiter action that MOVES a booking keeps the connected
    // calendar in step (one event per interview, PATCHed rather than re-created), and
    // every action that CLOSES one takes the event down. Same seam the candidate token
    // route uses, so the two paths cannot drift. Best-effort by construction: the write
    // records its own outcome on the invite and never throws — a Google outage must not
    // fail a recruiter's cancel.
    const writeCalendarEvent = async (booked: ScheduleInvite, entryId: string | null): Promise<void> => {
      const entry = entryId ? getPipelineEntry(entryId, ws) : null;
      await syncInterviewEvent(booked, {
        attendeeEmail: entry?.contact ?? null,
        baseUrl: publicBaseUrl(new URL(request.url).origin),
      });
    };

    // BOOK (Direction 3) — the manual week grid, routed through the ONE scheduling
    // engine. Confirming a candidate on the grid used to write a timezone-less
    // "Tue 14:00" free-text string straight onto the pipeline entry via approve_event,
    // with no collision check and no reminder. Now the grid resolves its wall-clock
    // pick to a canonical interview-zone instant (gridSlotToIso) and produces/updates
    // a collision-checked, reminder-eligible schedule_invites row — the SAME record a
    // candidate self-booking creates. Keyed by entryId (the grid has no token yet).
    //
    // The stage advance is done HERE, server-side, mirroring accept_proposal (:below):
    // the grid used to confirm the invite, then rely on the CLIENT to separately call
    // /api/pipeline approve_event. A failure of that second call left a confirmed
    // booking whose entry never advanced, with NO reconcile flag and NO sealed
    // decision — unlike the candidate token confirm and accept_proposal, both of which
    // advance server-side and flag drift on failure. Folding the advance in closes that
    // gap: one atomic recruiter action either advances or is flagged for reconcile.
    if (body.action === "book") {
      if (!body.entryId || (!body.dateSlot && !body.gridSlot)) {
        return jsonRefusal("SCHEDULE_BOOK_TARGET_MISSING", 400);
      }
      const entry = getPipelineEntry(body.entryId, ws);
      // Reuses the board's own code: the tab renders "that candidate is no longer on
      // this board", localized, instead of the generic failure line.
      if (!entry) return jsonRefusal("PIPELINE_ENTRY_NOT_FOUND", 404);
      // Never book an interview for a candidate the pipeline has closed out. Both invite
      // routes already refuse a terminal entry ("a drawer left open while the candidate
      // was rejected in another tab" — /api/schedule/invite), but the week grid did not,
      // and the grid's entry list is a CLIENT-side snapshot taken on mount. So a stale tab
      // confirmed a slot for a rejected candidate: the invite went 'confirmed', the slot
      // was consumed in the shared pool (bookedSlots, so a live candidate could no longer
      // take that hour) and a calendar event was written naming them as an attendee —
      // while approve_event no-op'd on the terminal entry, which returns null rather than
      // throwing, so nothing raised needs_reconcile and the board showed no failure at all.
      // Hired keeps status 'active', so only genuinely closed-out entries are refused.
      if (entry.status !== "active") {
        return jsonRefusal("SCHEDULE_CANDIDATE_INACTIVE", 409);
      }
      // Prefer the DATED pick ("YYYY-MM-DD HH:MM", the concrete cell the recruiter clicked)
      // so a booking lands on the true calendar day, not the next matching weekday. The
      // weekday-relative gridSlot stays a back-compat fallback (older clients / the sim).
      const resolved = body.dateSlot
        ? (() => {
            const [date = "", time = ""] = body.dateSlot.split(/\s+/);
            return dateSlotToIso(date, time);
          })()
        : gridSlotToIso(body.gridSlot!);
      if (!resolved) {
        return jsonRefusal("SCHEDULE_SLOT_UNRESOLVED", 400);
      }
      // Idempotent per entry: reuse the live invite (or mint one), then confirm/move it
      // to the resolved instant with recruiter authority (no candidate reschedule cap),
      // reusing the same collision-checked transactions the token flow uses.
      const invite = createScheduleInvite({
        entryId: entry.id,
        candidateLabel: entry.candidateLabel,
        jobTitle: entry.jobTitle,
        durationMin: plannedInterviewMinutes(entry),
      });
      // Hour-level occupancy (Direction 2): the store's collision authority is the exact
      // INSTANT, so a grid pick at 14:00 wouldn't clash with an accepted 14:30 proposal
      // sitting in the same hour — yet the week grid speaks in whole hours and shows that
      // hour as taken. Refuse the hour so the recruiter can't SILENTLY double-book it
      // (the off-hour booking keeps the hour). Same 409 + copy as an exact clash, since
      // from the grid's point of view the hour is spoken for. The entry's own current
      // booking is excluded so re-picking within its hour still moves it.
      const targetBucket = hourBucketKey(resolved.value);
      if (
        targetBucket &&
        bookedSlots(ws).some((iso) => iso !== invite.slotAt && hourBucketKey(iso) === targetBucket)
      ) {
        return jsonRefusal("SCHEDULE_SLOT_TAKEN", 409);
      }
      // W1.4 PARITY (Direction 2): the CANDIDATE confirm re-asks the interviewer's
      // connected calendar at the moment of booking (slotStillFree in the token
      // route); the recruiter's grid never did. So the very hour a candidate was
      // refused as a definite conflict was bookable from the other side of the same
      // app, and the interviewer's calendar was the thing kp was supposed to be
      // protecting. Same seam, same THREE-VALUED contract: only a definite `false`
      // refuses; `null` (no calendar connected, or the lookup failed) proceeds
      // exactly as it did before this check existed, because an outage must never
      // block a booking. No override affordance: a recruiter who genuinely wants the
      // hour clears it on their own calendar and books again.
      //
      // The entry's OWN confirmed booking at this instant is skipped: kp writes a
      // real calendar event for it, so re-confirming the same cell would be refused
      // by kp's own event.
      if (!(invite.status === "confirmed" && invite.slotAt === resolved.value)) {
        const calendarFree = await slotStillFree(resolved.value, ws, invite.durationMin ?? undefined);
        if (calendarFree === false) {
          return jsonRefusal("SCHEDULE_CALENDAR_BUSY", 409);
        }
      }
      let bookedInvite: ScheduleInvite;
      if (invite.status === "confirmed") {
        const moved = rescheduleScheduleInvite(invite.token, resolved.label, resolved.value, null, { recruiter: true });
        if (!moved.ok) {
          if (moved.reason === "taken") return jsonRefusal("SCHEDULE_SLOT_TAKEN", 409);
          return jsonRefusal("SCHEDULE_BOOK_FAILED", 409);
        }
        bookedInvite = moved.invite;
      } else {
        const booked = confirmScheduleInvite(invite.token, resolved.label, resolved.value);
        if (!booked.ok) {
          if (booked.reason === "taken") return jsonRefusal("SCHEDULE_SLOT_TAKEN", 409);
          return jsonRefusal("SCHEDULE_BOOK_FAILED", 409);
        }
        bookedInvite = booked.invite;
      }
      // Advance the linked entry server-side with the server-authored label (mirrors
      // accept_proposal): flag needs_reconcile rather than swallow a stage-gate failure.
      // approve_event records the slot without regressing an entry already past Interview,
      // so a re-book is safe; a terminal entry no-ops (returns null → not advanced).
      let advanced = false;
      try {
        // TENANCY: `ws` is the authenticated team this entry was itself read from (above).
        // Omitted, the advance ran against DEFAULT_WORKSPACE_ID and matched no row on any
        // other team — so a recruiter's grid booking confirmed the invite and wrote the
        // calendar event while the board card sat in Screening and the sealed record was
        // stamped with the qualified "didn't advance" reasonCode, every single time.
        // `undefined` for opts keeps the human actor / no-CAS default.
        advanced = actOnPipelineEntry(entry.id, "approve_event", resolved.label, undefined, ws) != null;
      } catch (advanceError) {
        markScheduleInviteNeedsReconcile(bookedInvite.token, advanceError instanceof Error ? advanceError.message : String(advanceError));
      }
      // The seal reflects REALITY: a booking whose entry didn't advance seals a qualified
      // reasonCode, never a clean "scheduled" the pipeline never reached (integrity fix).
      const outcome = scheduledSealOutcome(advanced);
      sealDecisionSafe({
        kind: "interview_scheduled",
        actor: "human:recruiter",
        policyVersion: "manual",
        candidateRef: entry.id,
        rationale: `Recruiter booked the interview on the week grid (${resolved.label}).${outcome.note}`,
        reasonCode: outcome.reasonCode,
        inputs: { slot: resolved.label, slotAt: resolved.value, advanced },
      });
      await writeCalendarEvent(bookedInvite, entry.id);
      return jsonOk({ invite: getScheduleInviteByToken(bookedInvite.token) ?? bookedInvite, slot: resolved.label, slotAt: resolved.value });
    }

    if (!body.token) {
      return jsonRefusal("SCHEDULE_TOKEN_REQUIRED", 400);
    }
    // Tenancy (P1): resolve the invite and refuse anything outside this team's
    // calendar — the token is a candidate capability, but the RECRUITER route is
    // workspace-authenticated, so a cross-team token must 404 here.
    const invite = getScheduleInviteByToken(body.token);
    if (!invite || invite.workspaceId !== ws) {
      return jsonRefusal("SCHEDULE_INVITE_NOT_FOUND", 404);
    }

    switch (body.action) {
      case "cancel": {
        // Free the slot and re-open the invite for re-booking (reuses the candidate
        // primitive). Outcome-bearing → seal the recruiter's decision.
        const updated = cancelAttendance(body.token);
        if (!updated) return jsonRefusal("SCHEDULE_CANCEL_NOT_CONFIRMED", 409);
        // `invite` is the PRE-cancel row and still carries the event id (cancelAttendance
        // clears the slot, not the calendar handle) — delete exactly that event.
        await removeInterviewEvent(invite);
        if (invite.entryId) {
          sealDecisionSafe({
            kind: "interview_cancelled",
            actor: "human:recruiter",
            policyVersion: "manual",
            candidateRef: invite.entryId,
            rationale: `Recruiter cancelled the interview (${invite.slot ?? "booked slot"}); the slot is freed for re-booking.`,
            reasonCode: "interview_cancelled",
            inputs: { previousSlot: invite.slot, previousSlotAt: invite.slotAt },
          });
        }
        // Re-read: the calendar removal above wrote calendar_event_state on this row, and
        // the panel needs the post-removal truth (including an 'orphaned' warning).
        return jsonOk({ invite: getScheduleInviteByToken(body.token) ?? updated });
      }
      case "no_show": {
        const updated = markScheduleInviteNoShow(body.token);
        if (!updated) return jsonRefusal("SCHEDULE_NO_SHOW_NOT_CONFIRMED", 409);
        // A no-show keeps slot_at as the record of the missed time, but the interview is
        // over — the calendar entry should not keep advertising it.
        await removeInterviewEvent(invite);
        if (invite.entryId) {
          sealDecisionSafe({
            kind: "interview_no_show",
            actor: "human:recruiter",
            policyVersion: "manual",
            candidateRef: invite.entryId,
            rationale: `Recruiter marked the interview (${invite.slot ?? "booked slot"}) as a no-show.`,
            reasonCode: "interview_no_show",
            inputs: { slot: invite.slot, slotAt: invite.slotAt },
          });
        }
        return jsonOk({ invite: getScheduleInviteByToken(body.token) ?? updated });
      }
      case "reschedule": {
        // Validate the target against the offered-slot mechanism (server-authored
        // label, TZ-correct instant) exactly like the candidate confirm, then move
        // via the shared transaction with recruiter authority (no candidate-cap).
        const offered = offeredSlotFor(body.slotAt);
        if (!offered) {
          // The candidate door's own code, reused rather than a second vocabulary for
          // the identical structural gate on body.slotAt.
          return jsonRefusal("SCHEDULE_SLOT_NOT_OFFERED", 400);
        }
        const moved = rescheduleScheduleInvite(body.token, offered.label, offered.value, null, { recruiter: true });
        if (!moved.ok) {
          if (moved.reason === "taken") return jsonRefusal("SCHEDULE_SLOT_TAKEN", 409);
          if (moved.reason === "not_confirmed") return jsonRefusal("SCHEDULE_RESCHEDULE_NOT_CONFIRMED", 409);
          return jsonRefusal("SCHEDULE_INVITE_NOT_FOUND", 404);
        }
        // Move the SAME calendar event to the new time (never a second one at it).
        await writeCalendarEvent(moved.invite, invite.entryId);
        return jsonOk({ invite: getScheduleInviteByToken(body.token) ?? moved.invite });
      }
      case "accept_proposal": {
        // Accept ONE of the candidate's proposed times (the "propose your own times"
        // escalation). The recruiter is trusted, but the accepted instant still passes
        // through the SAME collision-checked transactions the candidate flow uses — and
        // is re-validated (proposedSlotFor) in case the proposal has since aged into the
        // past. A confirmed invite (past the reschedule cap) moves with recruiter
        // authority; a pending invite books its first slot. Both clear the proposal state.
        // The same closed-out guard the grid book and the candidate token route apply:
        // accepting a proposed time CONFIRMS the booking and writes the calendar event, so
        // a candidate rejected since they proposed (the attention panel is a snapshot, and
        // its own re-invite control already gates on the linked entry via canReinvite) must
        // not be bookable through it. Hired keeps status 'active'.
        if (invite.entryId) {
          const linkedEntry = getPipelineEntry(invite.entryId, ws);
          if (linkedEntry && linkedEntry.status !== "active") {
            return jsonRefusal("SCHEDULE_CANDIDATE_INACTIVE", 409);
          }
        }
        const chosen = (invite.proposals ?? []).find((p) => p.value === body.slotAt);
        if (!chosen) {
          return jsonRefusal("SCHEDULE_PROPOSAL_GONE", 409);
        }
        const offered = proposedSlotFor(chosen.value);
        if (!offered) {
          return jsonRefusal("SCHEDULE_PROPOSAL_EXPIRED", 409);
        }
        const result =
          invite.status === "confirmed"
            ? rescheduleScheduleInvite(body.token, offered.label, offered.value, null, { recruiter: true })
            : confirmScheduleInvite(body.token, offered.label, offered.value);
        if (!result.ok) {
          if (result.reason === "taken") return jsonRefusal("SCHEDULE_SLOT_TAKEN", 409);
          return jsonRefusal("SCHEDULE_BOOK_FAILED", 409);
        }
        // Keep the recruiter board in sync (mirrors the candidate confirm): record the
        // slot on the linked entry, flagging drift rather than swallowing a stage-gate
        // failure; seal the outcome-bearing decision.
        if (invite.entryId) {
          let advanced = false;
          try {
            // TENANCY: `ws` — the authenticated team, already proven to own this invite by
            // the `invite.workspaceId !== ws` 404 above. Omitted, the advance fell back to
            // DEFAULT_WORKSPACE_ID and matched nothing on any other team: accepting the
            // candidate's proposed time booked the slot and wrote the calendar event, but
            // the board card never moved to Interview and the sealed decision recorded the
            // qualified "didn't advance" reasonCode instead of a clean scheduled outcome.
            advanced = actOnPipelineEntry(invite.entryId, "approve_event", offered.label, undefined, ws) != null;
          } catch (advanceError) {
            markScheduleInviteNeedsReconcile(body.token, advanceError instanceof Error ? advanceError.message : String(advanceError));
          }
          // Same integrity fix as the grid book: the seal reflects whether the entry
          // actually advanced (qualified reasonCode when it didn't), consistently.
          const outcome = scheduledSealOutcome(advanced);
          sealDecisionSafe({
            kind: "interview_scheduled",
            actor: "human:recruiter",
            policyVersion: "manual",
            candidateRef: invite.entryId,
            rationale: `Recruiter accepted the candidate's proposed time (${offered.label}).${outcome.note}`,
            reasonCode: outcome.reasonCode,
            inputs: { slot: offered.label, slotAt: offered.value, advanced },
          });
        }
        await writeCalendarEvent(result.invite, invite.entryId);
        return jsonOk({ invite: getScheduleInviteByToken(body.token) });
      }
      case "decline_proposals": {
        // The recruiter couldn't accommodate any proposed time: clear them and record
        // the honest 'declined' state the candidate page reads. The booking (if any) is
        // untouched — declining alternatives isn't cancelling a confirmed interview.
        const updated = declineScheduleInviteProposals(body.token);
        if (!updated) return jsonRefusal("SCHEDULE_NO_PROPOSALS", 409);
        if (invite.entryId) {
          sealDecisionSafe({
            kind: "interview_proposal_declined",
            actor: "human:recruiter",
            policyVersion: "manual",
            candidateRef: invite.entryId,
            rationale: "Recruiter could not accommodate the candidate's proposed times; the candidate is told to expect direct outreach.",
            reasonCode: "interview_proposal_declined",
            inputs: {},
          });
        }
        return jsonOk({ invite: updated });
      }
      case "resolve_reconcile": {
        const resolved = resolveScheduleInviteReconcile(body.token);
        if (!resolved) return jsonRefusal("SCHEDULE_NOTHING_TO_RECONCILE", 409);
        return jsonOk({ invite: getScheduleInviteByToken(body.token) });
      }
      default:
        return jsonRefusal("SCHEDULE_ACTION_UNKNOWN", 400);
    }
  } catch (error) {
    return safeJsonError(error, "api:schedule", "SCHEDULE_MANAGE_FAILED");
  }
}

// http/https only — a meeting link is rendered as an <a> and baked into a calendar
// event, so reject javascript:/data: and anything unparseable. Empty ⇒ clear (null).
function normalizeMeetingUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

// PATCH → recruiter attaches (or clears) an interview join link on an invite. The
// meeting link is rendered as the trusted "Join" button on the recruiter agenda
// and baked into both calendar events, so writing it is a RECRUITER capability:
// the route is workspace-authenticated (like POST /api/schedule) and a token that
// belongs to another team — or is merely the candidate's own token — must 404
// before any write. (The candidate's token route keeps a read-only view of
// meetingUrl.) Rate-limited per IP as an additional backstop.
export async function PATCH(request: Request) {
  try {
    if (!rateLimit(`sched-meet:${clientIpFrom(request.headers)}`, { limit: 60, windowMs: 60_000 })) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    const ws = await currentWorkspace();
    const body = (await request.json().catch(() => ({}))) as { token?: string; meetingUrl?: string | null };
    if (!body.token) return jsonRefusal("SCHEDULE_TOKEN_REQUIRED", 400);
    // Refuse a token outside this team's calendar before writing — mirrors the
    // POST handler's invite.workspaceId !== ws check.
    const invite = getScheduleInviteByToken(body.token);
    if (!invite || invite.workspaceId !== ws) {
      return jsonRefusal("SCHEDULE_INVITE_NOT_FOUND", 404);
    }
    const raw = typeof body.meetingUrl === "string" ? body.meetingUrl.trim() : "";
    let url: string | null = null;
    if (raw) {
      url = normalizeMeetingUrl(raw);
      if (!url) return jsonRefusal("SCHEDULE_MEETING_URL_INVALID", 400);
    }
    const updated = setScheduleInviteMeetingUrl(body.token, url);
    if (!updated) return jsonRefusal("SCHEDULE_INVITE_NOT_FOUND", 404);
    // The meeting link is the calendar event's LOCATION. If kp already wrote an event for
    // this interview, refresh it — otherwise the interviewer opens the entry at call time
    // and finds the placeholder location while the link lives only inside kp. Only ever an
    // UPDATE (the `calendarEventId` guard): attaching a link never creates an event, so a
    // pending invite with no booking is untouched. Best-effort, as everywhere.
    if (updated.calendarEventId) {
      const entry = updated.entryId ? getPipelineEntry(updated.entryId, ws) : null;
      await syncInterviewEvent(updated, {
        attendeeEmail: entry?.contact ?? null,
        baseUrl: publicBaseUrl(new URL(request.url).origin),
      });
    }
    return jsonOk({ invite: getScheduleInviteByToken(body.token) ?? updated });
  } catch (error) {
    return safeJsonError(error, "api:schedule", "SCHEDULE_LOOKUP_FAILED");
  }
}
