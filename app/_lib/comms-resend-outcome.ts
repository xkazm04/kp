// ONE reading of what `POST /api/comms/[id]/resend` just did — shared by the two
// buttons that call it (app/features/tools/devcases/ResendButton.tsx and the Comms
// Center's ChannelsCommsBouncedResend.tsx), which used to duplicate the fold verbatim
// and got it wrong in the same way.
//
// FIVE outcomes, because the route answers 200 for three of them and 409 for two
// DIFFERENT things:
//   refused       — a non-2xx the recruiter must act on (404 unknown, 422 incomplete,
//                   429 throttled). The machine `code` travels so the reader gets the
//                   reason in their own language (use-error-message.ts).
//   recovered     — 409 + `recovered: true`. The route's two de-dup doors (the
//                   in-process in-flight Set and the durable "a newer delivery already
//                   exists" read) refuse a SECOND dispatch precisely because the
//                   message IS going out. Both clients folded this into the red
//                   "couldn't re-send", so a recruiter who double-clicked a bounce
//                   read a failure over a delivered message. It is calm, never red.
//   deadLettered  — 200, but the new row is `failed`/`bounced`: the relay rejected it
//                   again. `failureDetail` is why.
//   queued        — 200, and the row is `queued`: recorded, and NOTHING will deliver
//                   it (no relay configured — comms-status.ts's terminal local state).
//   sent          — the only outcome that may say "Resent".
//
// Pure and framework-free on purpose: it is the thing both components are tested
// through, and a component test cannot pin a fold that lives inside a click handler.

export const RESEND_OUTCOMES = ["refused", "recovered", "deadLettered", "queued", "sent"] as const;
export type ResendOutcomeKind = (typeof RESEND_OUTCOMES)[number];

/** The response body shape the route can produce, as the client may read it. */
export interface ResendResponsePayload {
  error?: string | null;
  code?: string | null;
  /** Set by `jsonRefusal(..., 409, { recovered: true })` on both throttle doors. */
  recovered?: boolean;
  entry?: { status?: string | null; failureDetail?: string | null } | null;
}

export type ResendOutcome =
  | { kind: "refused"; code: string | null }
  | { kind: "recovered"; code: string | null }
  | { kind: "deadLettered"; detail: string | null }
  | { kind: "queued" }
  | { kind: "sent" };

/** Adverse = "this needs you", the only two outcomes painted in the failure tone.
 *  `recovered` is deliberately NOT one of them. */
export function isAdverseResend(kind: ResendOutcomeKind): boolean {
  return kind === "refused" || kind === "deadLettered";
}

/** Read one resend response. `ok`/`status` come from the Response, `payload` from its
 *  parsed body (null when the body was absent or unparseable). */
export function resendOutcome(ok: boolean, status: number, payload: ResendResponsePayload | null): ResendOutcome {
  if (!ok) {
    // Only the route's own shape counts: 409 AND the explicit marker. A 409 without it
    // (or the marker on any other status) is a refusal — claiming delivery off a loose
    // flag is the same green lie in the other direction.
    if (status === 409 && payload?.recovered === true) return { kind: "recovered", code: payload.code ?? null };
    return { kind: "refused", code: payload?.code ?? null };
  }
  const entryStatus = payload?.entry?.status;
  if (entryStatus === "queued") return { kind: "queued" };
  if (entryStatus === "failed" || entryStatus === "bounced") {
    return { kind: "deadLettered", detail: payload?.entry?.failureDetail ?? null };
  }
  return { kind: "sent" };
}

// --- which recovery DOOR a letter offers: ONE predicate for every resend surface ---

/** Channel literals, declared in this import-free module so client code can read them;
 *  comms-dispatch.ts declares its own copies (so route graphs do not gain this module),
 *  pinned equal by comms-dispatch-channels.test.ts. A simulation row the route refuses
 *  (COMM_SIMULATION_ROW); a refused row has recipient "" so the route 422s. */
export const SIM_COMMS_CHANNEL = "simulation";
export const REFUSED_COMMS_CHANNEL = "refused";

/** retry = one-click re-dispatch; correctAddress = a bounce (same address bounces again). */
export type ResendDoor = "retry" | "correctAddress";

/** The send gate (comms.ts commsSendSuppression) refuses every letter in these states. */
const UNCONTACTABLE_CONSENT: ReadonlySet<string> = new Set(["anonymized", "expired"]);

/** The door a letter offers, or null. `verdict` is commsVerdict's, never the raw status
 *  (a recovered row already has a later delivery). `consentStatus` only from a surface
 *  that knows the candidate; otherwise the route's gate stays the authority. */
export function resendDoorOf(
  m: { verdict: string; channel?: string | null },
  consentStatus?: string | null
): ResendDoor | null {
  if (m.channel === SIM_COMMS_CHANNEL || m.channel === REFUSED_COMMS_CHANNEL) return null;
  if (consentStatus && UNCONTACTABLE_CONSENT.has(consentStatus)) return null;
  if (m.verdict === "bounced") return "correctAddress";
  if (m.verdict === "failed") return "retry";
  return null;
}

/** The letters that need the recruiter: exactly those with a door. */
export function lettersNeedingYou(
  comms: ReadonlyArray<{ verdict: string; channel?: string | null }>,
  consentStatus?: string | null
): number {
  return comms.reduce((n, m) => (resendDoorOf(m, consentStatus) ? n + 1 : n), 0);
}
