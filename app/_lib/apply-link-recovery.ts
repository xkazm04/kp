import type { PipelineEntry } from "./db/core";
import { ensureLeadEnrichToken } from "./db/pipeline";
import { isThrottled, recordFailedAttempt, type ThrottleOpts } from "./auth/login-throttle";
import { getOrCreateStatusLink } from "./application-status-store";
import { resolveCommsLocale } from "./comms-locale";
import { dispatchApplicationLinks } from "./comms-dispatch";

// LINK RECOVERY FOR A RETURNING APPLICANT (challenge 2026-09-22, candidate-apply-api/B).
//
// A repeat application matched on name/email alone is UNPROVEN, and the capability
// gate on both apply doors rightly hands that caller none of the matched entry's
// tokens (app/api/apply/[id]/route.ts acknowledgeReapply, quick/route.ts). That left
// the REAL returning candidate, the one who lost the acknowledgement email, at a dead
// end: no status link, no way to update the application, and a card with no action.
//
// The recovery delivers the capability to the one party who can prove ownership: the
// inbox already on the entry. Nothing new is exposed to the caller:
//   - the send goes to `entry.contact`, never to the address the request typed (on the
//     email match they are the same normalized address; on a name match the typed one
//     is ignored outright);
//   - the response copy is chosen WITHOUT reading whether an address exists
//     (recoveryMessageKey), so the answer cannot be used to probe for one;
//   - one send per ENTRY per 24h, persisted across workers (login-throttle), so a
//     griefer can cause at most one email a day, to the real candidate, carrying only
//     that candidate's own links. The route's per-IP limiter still runs first;
//   - no pipeline event and no consent refresh: the Outbox row is the audit, and the
//     unproven path stays out of the recruiter's activity feed.

/** One recovery per entry per 24 hours. */
export const LINK_RECOVERY_THROTTLE: ThrottleOpts = { limit: 1, windowMs: 24 * 60 * 60_000 };

/** The persisted cooldown bucket. Keyed on the ENTRY, never on the caller: the
 *  thing being protected is the candidate's inbox, whoever is asking. */
export function linkRecoveryKey(entryId: string): string {
  return `apply-links:${entryId}`;
}

export type LinkRecoverySkip = "no_contact" | "anonymized" | "cooldown";
export type LinkRecoveryDecision = { send: true } | { send: false; reason: LinkRecoverySkip };

/** Whether to re-send an entry's links. Pure.
 *
 *  `relayConfigured` does NOT gate the send: with no relay the dispatch records an
 *  honest `queued` Outbox row (the same terminal state the first acknowledgement
 *  gets), which the operator's Comms Center shows and a relay configured later can
 *  deliver through the resend door. It is part of the input so the one place that
 *  decides the recovery is the one place that sees everything the route knows. */
export function decideLinkRecovery(input: {
  contact: string | null | undefined;
  anonymized: boolean;
  throttled: boolean;
  relayConfigured: boolean;
}): LinkRecoveryDecision {
  if (!(input.contact ?? "").trim()) return { send: false, reason: "no_contact" };
  if (input.anonymized) return { send: false, reason: "anonymized" };
  if (input.throttled) return { send: false, reason: "cooldown" };
  return { send: true };
}

/** The `apply` catalog key the unproven duplicate answers with. Takes ONLY the relay
 *  state: an entry with an address on file and one without get the same sentence,
 *  so the response reveals nothing about what is on file. */
export function recoveryMessageKey(relayConfigured: boolean): "alreadyMessageRecover" | "alreadyMessageNoRelay" {
  return relayConfigured ? "alreadyMessageRecover" : "alreadyMessageNoRelay";
}

/** Decide, claim the cooldown, mint the entry's own links and schedule the send.
 *  Best-effort throughout: the caller has already answered the candidate honestly,
 *  so a failure here is logged and never turns the response into an error.
 *
 *  `base` is the absolute public origin (publicBaseUrl) — the links are opened from
 *  an email, outside the app. `defer` schedules the dispatch after the response
 *  (afterResponse), like every other acknowledgement on these doors. */
export function recoverApplicationLinks(
  entry: PipelineEntry,
  opts: { base: string; relayConfigured: boolean; defer: (task: () => Promise<unknown>) => void; nowMs?: number }
): LinkRecoveryDecision {
  const nowMs = opts.nowMs ?? Date.now();
  const key = linkRecoveryKey(entry.id);
  // ONLY the address on the entry. candidateRecipient would fall back to the label
  // or the profile id for a contactless entry, and sendCandidateComm would then hand
  // a relay something it cannot deliver; no contact means no send, and no row.
  const contact = entry.contact;
  let decision: LinkRecoveryDecision;
  try {
    decision = decideLinkRecovery({
      contact,
      anonymized: Boolean(entry.anonymizedAt),
      throttled: Boolean((contact ?? "").trim()) && isThrottled(key, LINK_RECOVERY_THROTTLE, nowMs),
      relayConfigured: opts.relayConfigured,
    });
    if (!decision.send) return decision;
    // Claim the slot atomically (one UPSERT): of two racing requests only the one
    // that counts 1 sends — the read above is a cheap pre-check, not the lock.
    if (recordFailedAttempt(key, LINK_RECOVERY_THROTTLE, nowMs) > 1) return { send: false, reason: "cooldown" };
  } catch (err) {
    console.error(`[apply] link recovery skipped for entry ${entry.id}:`, err instanceof Error ? err.message : err);
    return { send: false, reason: "cooldown" };
  }

  // Pinned to the language the EMAIL renders in (the entry's own, resolved against
  // its team), not the language of whoever POSTed.
  const lang = resolveCommsLocale(entry.locale, entry.workspaceId);
  let statusLink: string | undefined;
  let enrichLink: string | undefined;
  try {
    statusLink = `${opts.base}/status/${getOrCreateStatusLink(entry.id)}?lang=${lang}`;
  } catch (err) {
    console.error(`[apply] link recovery: no status link for entry ${entry.id}:`, err instanceof Error ? err.message : err);
  }
  try {
    const leadToken = entry.jobId ? ensureLeadEnrichToken(entry.id, undefined, entry.workspaceId) : null;
    if (leadToken) enrichLink = `${opts.base}/apply/${entry.jobId}?lang=${lang}&lead=${encodeURIComponent(leadToken)}`;
  } catch (err) {
    console.error(`[apply] link recovery: no enrichment link for entry ${entry.id}:`, err instanceof Error ? err.message : err);
  }
  if (!statusLink && !enrichLink) return decision;

  opts.defer(async () => {
    try {
      await dispatchApplicationLinks(entry, { statusLink, enrichLink });
    } catch (err) {
      console.error(`[apply] link recovery dispatch failed for entry ${entry.id}:`, err instanceof Error ? err.message : err);
    }
  });
  return decision;
}
