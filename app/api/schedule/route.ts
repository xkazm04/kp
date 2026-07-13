import { NextResponse } from "next/server";
import {
  bookedSlots,
  cancelAttendance,
  getScheduleInviteByToken,
  listScheduleInvites,
  markScheduleInviteNoShow,
  rescheduleScheduleInvite,
  resolveScheduleInviteReconcile,
  setScheduleInviteMeetingUrl,
} from "@/app/_lib/schedule-store";
import { offeredSlotFor, proposeSlots } from "@/app/_lib/schedule-slots";
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
      return NextResponse.json({ slots: proposeSlots(bookedSlots(ws)) });
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
    const body = (await request.json().catch(() => ({}))) as { token?: string; action?: string; slotAt?: string };
    if (!body.token || !body.action) {
      return NextResponse.json({ error: "token and action are required" }, { status: 400 });
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

// PATCH → recruiter attaches (or clears) an interview join link on an invite. Same
// no-auth-layer posture as POST /api/schedule/invite (rate-limited per IP); the
// candidate never reaches this route (they use the token route).
export async function PATCH(request: Request) {
  try {
    if (!rateLimit(`sched-meet:${clientIpFrom(request.headers)}`, { limit: 60, windowMs: 60_000 })) {
      return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
    }
    const body = (await request.json().catch(() => ({}))) as { token?: string; meetingUrl?: string | null };
    if (!body.token) return NextResponse.json({ error: "token is required" }, { status: 400 });
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
