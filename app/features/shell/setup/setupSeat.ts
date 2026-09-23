// The wizard's SEAT — who is answering, as the capability set the finish doors
// gate on.
//
// The '/' gate fires PER USER (auth/onboarding-gate.ts) and a redeemed invite lands
// on '/' (invite/[token]/invite-result.ts), so after the owner the wizard's most
// frequent audience is the owner's teammates. The step model used to know only the
// intent, so an invited recruiter was asked for the company name (required, and
// blank on their browser), a currency, a brand and invites — and finished into a
// refusal on every one of them. Steps now DECLARE the capability their answers
// need (`requires` in setupSteps.ts), and this seat is the other half of the
// predicate.
//
// Read once from GET /api/me/onboarding: callerOrgCapabilities() ∪
// callerCapabilities(), exactly the two resolvers the finish doors gate on — so the
// wizard can only mirror authority the server holds, never invent it. Open mode and
// an operator session fold to owner there, so the keyless first run is unchanged.
//
// FAIL OPEN, like navCapabilities.ts: a null seat (the read is in flight, or it
// failed) is today's full run. Hiding the owner's Company step because one GET
// blipped would be a worse failure than the one this closes, and the server stays
// the enforcement either way.
import { isCapability, type Capability } from "@/app/_lib/auth/roles";
import { commandAllowed, TOUR_CAPABILITY } from "@/app/features/shell/navCapabilities";

/** The caller's capabilities, or null = unknown (fail open). */
export type SetupSeat = readonly Capability[] | null;

/** The seat off the GET /api/me/onboarding body. Anything that is not a
 *  `{ seat: { capabilities: [] } }` shape is an unknown seat (null); inside a real
 *  one, only real capabilities survive. An EMPTY list is a real seat — a caller who
 *  may do nothing — and is kept, not widened to null. */
export function parseSetupSeat(body: unknown): SetupSeat {
  if (!body || typeof body !== "object") return null;
  const seat = (body as { seat?: unknown }).seat;
  if (!seat || typeof seat !== "object") return null;
  const caps = (seat as { capabilities?: unknown }).capabilities;
  if (!Array.isArray(caps)) return null;
  return [...new Set(caps.filter(isCapability))];
}

/** May this seat make a write that needs `cap`? Unknown seat ⇒ yes. */
export function seatAllows(seat: SetupSeat, cap: Capability): boolean {
  return !seat || seat.includes(cap);
}

/** The hand-off's exits for this seat. The guided tour STARTS A RUN that moves
 *  candidates (navCapabilities.ts, TOUR_CAPABILITY), so a seat that may not write
 *  the pipeline is offered only the solo exit — the same rule the shell's palette
 *  applies to the tour command. */
export type HandoffExit = "tour" | "solo";
export function handoffExits(seat: SetupSeat): HandoffExit[] {
  return commandAllowed(TOUR_CAPABILITY, seat) ? ["tour", "solo"] : ["solo"];
}
