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
import { actOnPipelineEntry, getPipelineEntry } from "@/app/_lib/db";
import { plannedInterviewMinutes } from "@/app/_lib/interview-run";
import { dateSlotToIso, gridSlotToIso, hourBucketKey, offeredSlotFor, proposedSlotFor, proposeSlots, scheduledSealOutcome } from "@/app/_lib/schedule-slots";
import { proposeFreeSlots } from "@/app/_lib/calendar/available-slots";
import { sealDecisionSafe } from "@/app/_lib/decision-record-store";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { jsonOk, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";


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
    if (new URL(request.url).searchParams.has("slots")) {
      // W1.4 — also skips times the connected calendar is busy for. Degrades to the
      // pre-integration list when no calendar is connected or the lookup fails, so the
      // reschedule control never goes dark because Google did.
      const proposed = await proposeFreeSlots(bookedSlots(ws), ws);
      return NextResponse.json({
        slots: proposed.slots,
        calendarChecked: proposed.calendarChecked,
        droppedForConflict: proposed.droppedForConflict,
      });
    }
    return NextResponse.json({ invites: listScheduleInvites(200, ws) });
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
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
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
      return NextResponse.json({ error: "action is required" }, { status: 400 });
    }

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
        return NextResponse.json({ error: "entryId and dateSlot are required" }, { status: 400 });
      }
      const entry = getPipelineEntry(body.entryId, ws);
      if (!entry) return NextResponse.json({ error: "pipeline entry not found" }, { status: 404 });
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
        return NextResponse.json({ error: "That grid slot couldn't be resolved to a time." }, { status: 400 });
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
        return NextResponse.json({ error: "That time is already booked — pick another." }, { status: 409 });
      }
      let bookedInvite: ScheduleInvite;
      if (invite.status === "confirmed") {
        const moved = rescheduleScheduleInvite(invite.token, resolved.label, resolved.value, null, { recruiter: true });
        if (!moved.ok) {
          if (moved.reason === "taken") return NextResponse.json({ error: "That time is already booked — pick another." }, { status: 409 });
          return NextResponse.json({ error: "Could not update that booking." }, { status: 409 });
        }
        bookedInvite = moved.invite;
      } else {
        const booked = confirmScheduleInvite(invite.token, resolved.label, resolved.value);
        if (!booked.ok) {
          if (booked.reason === "taken") return NextResponse.json({ error: "That time is already booked — pick another." }, { status: 409 });
          return NextResponse.json({ error: "Could not book that time." }, { status: 409 });
        }
        bookedInvite = booked.invite;
      }
      // Advance the linked entry server-side with the server-authored label (mirrors
      // accept_proposal): flag needs_reconcile rather than swallow a stage-gate failure.
      // approve_event records the slot without regressing an entry already past Interview,
      // so a re-book is safe; a terminal entry no-ops (returns null → not advanced).
      let advanced = false;
      try {
        advanced = actOnPipelineEntry(entry.id, "approve_event", resolved.label) != null;
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
      return jsonOk({ invite: bookedInvite, slot: resolved.label, slotAt: resolved.value });
    }

    if (!body.token) {
      return NextResponse.json({ error: "token is required" }, { status: 400 });
    }
    // Tenancy (P1): resolve the invite and refuse anything outside this team's
    // calendar — the token is a candidate capability, but the RECRUITER route is
    // workspace-authenticated, so a cross-team token must 404 here.
    const invite = getScheduleInviteByToken(body.token);
    if (!invite || invite.workspaceId !== ws) {
      return NextResponse.json({ error: "invite not found" }, { status: 404 });
    }

    switch (body.action) {
      case "cancel": {
        // Free the slot and re-open the invite for re-booking (reuses the candidate
        // primitive). Outcome-bearing → seal the recruiter's decision.
        const updated = cancelAttendance(body.token);
        if (!updated) return NextResponse.json({ error: "Only a confirmed booking can be cancelled." }, { status: 409 });
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
        return jsonOk({ invite: updated });
      }
      case "no_show": {
        const updated = markScheduleInviteNoShow(body.token);
        if (!updated) return NextResponse.json({ error: "Only a confirmed booking can be marked as a no-show." }, { status: 409 });
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
        return jsonOk({ invite: updated });
      }
      case "reschedule": {
        // Validate the target against the offered-slot mechanism (server-authored
        // label, TZ-correct instant) exactly like the candidate confirm, then move
        // via the shared transaction with recruiter authority (no candidate-cap).
        const offered = offeredSlotFor(body.slotAt);
        if (!offered) {
          return NextResponse.json({ error: "Pick one of the offered reschedule slots." }, { status: 400 });
        }
        const moved = rescheduleScheduleInvite(body.token, offered.label, offered.value, null, { recruiter: true });
        if (!moved.ok) {
          if (moved.reason === "taken") {
            return NextResponse.json({ error: "That time is already booked — pick another." }, { status: 409 });
          }
          if (moved.reason === "not_confirmed") {
            return NextResponse.json({ error: "Only a confirmed booking can be rescheduled." }, { status: 409 });
          }
          return NextResponse.json({ error: "invite not found" }, { status: 404 });
        }
        return jsonOk({ invite: moved.invite });
      }
      case "accept_proposal": {
        // Accept ONE of the candidate's proposed times (the "propose your own times"
        // escalation). The recruiter is trusted, but the accepted instant still passes
        // through the SAME collision-checked transactions the candidate flow uses — and
        // is re-validated (proposedSlotFor) in case the proposal has since aged into the
        // past. A confirmed invite (past the reschedule cap) moves with recruiter
        // authority; a pending invite books its first slot. Both clear the proposal state.
        const chosen = (invite.proposals ?? []).find((p) => p.value === body.slotAt);
        if (!chosen) {
          return NextResponse.json({ error: "That proposed time is no longer on the invite." }, { status: 409 });
        }
        const offered = proposedSlotFor(chosen.value);
        if (!offered) {
          return NextResponse.json({ error: "That proposed time has passed — ask the candidate to suggest new times." }, { status: 409 });
        }
        const result =
          invite.status === "confirmed"
            ? rescheduleScheduleInvite(body.token, offered.label, offered.value, null, { recruiter: true })
            : confirmScheduleInvite(body.token, offered.label, offered.value);
        if (!result.ok) {
          if (result.reason === "taken") {
            return NextResponse.json({ error: "That time is already booked — pick another." }, { status: 409 });
          }
          return NextResponse.json({ error: "Could not book that time." }, { status: 409 });
        }
        // Keep the recruiter board in sync (mirrors the candidate confirm): record the
        // slot on the linked entry, flagging drift rather than swallowing a stage-gate
        // failure; seal the outcome-bearing decision.
        if (invite.entryId) {
          let advanced = false;
          try {
            advanced = actOnPipelineEntry(invite.entryId, "approve_event", offered.label) != null;
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
        return jsonOk({ invite: getScheduleInviteByToken(body.token) });
      }
      case "decline_proposals": {
        // The recruiter couldn't accommodate any proposed time: clear them and record
        // the honest 'declined' state the candidate page reads. The booking (if any) is
        // untouched — declining alternatives isn't cancelling a confirmed interview.
        const updated = declineScheduleInviteProposals(body.token);
        if (!updated) return NextResponse.json({ error: "There are no proposed times to decline." }, { status: 409 });
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
        if (!resolved) return NextResponse.json({ error: "Nothing to reconcile on this invite." }, { status: 409 });
        return jsonOk({ invite: getScheduleInviteByToken(body.token) });
      }
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
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
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }
    const ws = await currentWorkspace();
    const body = (await request.json().catch(() => ({}))) as { token?: string; meetingUrl?: string | null };
    if (!body.token) return NextResponse.json({ error: "token is required" }, { status: 400 });
    // Refuse a token outside this team's calendar before writing — mirrors the
    // POST handler's invite.workspaceId !== ws check.
    const invite = getScheduleInviteByToken(body.token);
    if (!invite || invite.workspaceId !== ws) {
      return NextResponse.json({ error: "invite not found" }, { status: 404 });
    }
    const raw = typeof body.meetingUrl === "string" ? body.meetingUrl.trim() : "";
    let url: string | null = null;
    if (raw) {
      url = normalizeMeetingUrl(raw);
      if (!url) return NextResponse.json({ error: "Enter a valid http(s) meeting link." }, { status: 400 });
    }
    const updated = setScheduleInviteMeetingUrl(body.token, url);
    if (!updated) return NextResponse.json({ error: "invite not found" }, { status: 404 });
    return NextResponse.json({ invite: updated });
  } catch (error) {
    return safeJsonError(error, "api:schedule", "SCHEDULE_LOOKUP_FAILED");
  }
}
