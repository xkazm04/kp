import { dispatchOfferReminder } from "./comms-dispatch";
import { getPipelineEntry } from "./db/pipeline";
import { dueOfferReminders, markOfferReminded } from "./offers-store";
import { publicBaseUrl } from "./public-base-url";

// Proactive offer-expiry reminders (idea-29361408 follow-up). Run on the
// instrumentation heartbeat (every ~60s), right beside lapseExpiredOffers: that sweep
// flips an un-answered offer to 'expired' ON its deadline; this one sends the single
// heads-up BEFORE that, so a candidate who simply forgot doesn't lose a live offer to
// silence (the company's lever is the deadline; the reminder is the courtesy nudge).
//
// AT-MOST-ONCE by design. The claim (markOfferReminded) CAS-stamps reminded_at BEFORE
// dispatch, so a re-tick — or a second process — can't send a duplicate nudge on a
// money-bearing, candidate-facing channel (a duplicate is worse than a miss here). A
// dispatch failure after the claim is logged, not retried: the offer still lapses on
// its deadline and the candidate can act any time before then. The heartbeat never
// overlaps itself (instrumentation.ts arms the next tick only after this settles), so
// one claimed offer is dispatched exactly once per process.
export async function sendDueOfferReminders(): Promise<number> {
  const due = dueOfferReminders();
  let sent = 0;
  for (const offer of due) {
    // No entry → no deliverable recipient; nothing to remind. (Won't re-claim it next
    // tick — but with no entry it could never be delivered anyway.)
    if (!offer.entryId) continue;
    // Claim first: only the writer that flips reminded_at proceeds to dispatch.
    if (!markOfferReminded(offer.token)) continue;
    // Tenant: the OFFER ROW is the only authority here — the heartbeat has no session,
    // so there is no currentWorkspace() to ask. offer.workspaceId is the workspace
    // stamped from the entry at createOffer. Bare, this by-id read fell to
    // DEFAULT_WORKSPACE_ID and returned null for every other team, so the `continue`
    // below dropped them AFTER the claim above had already burned their one-shot
    // reminder: a non-default team's candidate got no heads-up at all and watched a
    // live offer lapse in silence, with reminded_at stamped as if we'd nudged them.
    const entry = getPipelineEntry(offer.entryId, offer.workspaceId);
    if (!entry) continue; // entry vanished between the offer row and now — nothing to send
    const base = publicBaseUrl(); // heartbeat has no request origin → APP_BASE_URL / "" fallback
    const link = `${base}/offer/${offer.token}`;
    try {
      await dispatchOfferReminder(entry, link, offer.expiresAt);
      sent += 1;
    } catch (err) {
      // Claimed but not delivered. Logged, not re-armed (reminded_at is set): a missed
      // nudge is benign; a duplicate on this channel is not. An operator can reach out.
      console.error(
        `[offer-reminder] claimed but dispatch failed for token ${offer.token} (entry ${offer.entryId}): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
  return sent;
}
