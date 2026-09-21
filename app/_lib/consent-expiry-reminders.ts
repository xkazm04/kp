import { dispatchConsentExpiryReminder } from "./comms-dispatch";
import { outreachSuppressionReason } from "./consent";
import { claimConsentExpiryNotice, getPipelineEntry, listConsentExpiryNoticeDue } from "./db/pipeline";
import { outreachHaltFor } from "./outreach-state-store";

// Pre-expiry consent reminder. Sibling to anonymizeExpiredConsents: that sweep
// scrubs PII once the window has lapsed; this one writes exactly one
// `expiring_notified` event and one candidate letter in the 30-day window before
// that, so the person can renew or request erasure first (GDPR Art. 13/14).
//
// AT-MOST-ONCE by design. The claim (claimConsentExpiryNotice) CAS-inserts the
// consent event BEFORE dispatch, so a re-tick cannot double-send. A dispatch
// failure after the claim is logged, not retried. Honour outreach suppression
// (anonymized / consent_expired) and a candidate opt-out so the reminder cannot
// re-arm a halted recipient.
export async function notifyExpiringConsents(nowIso: string = new Date().toISOString()): Promise<number> {
  const due = listConsentExpiryNoticeDue(nowIso);
  const nowMs = Date.parse(nowIso);
  let sent = 0;
  for (const { id, workspace_id } of due) {
    const entry = getPipelineEntry(id, workspace_id);
    if (!entry) continue;
    if (
      outreachSuppressionReason(
        { givenAt: entry.consentGivenAt, expiresAt: entry.consentExpiresAt, anonymizedAt: entry.anonymizedAt },
        nowMs,
      )
    ) {
      continue;
    }
    if (outreachHaltFor(entry.id, workspace_id) === "candidate") continue;
    if (!claimConsentExpiryNotice(id, nowIso, workspace_id)) continue;
    try {
      await dispatchConsentExpiryReminder(entry);
      sent += 1;
    } catch (err) {
      console.error(
        `[consent-expiry] claimed but dispatch failed for entry ${id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return sent;
}
