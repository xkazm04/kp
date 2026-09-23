// THE rediscovery eligibility gate: "may this person be surfaced for a role they never
// applied to?" One predicate, read at every door that ranks, writes, lists or acts on a
// silver medalist, so the answer cannot fork between them:
//
//   rank   rediscoverForJob            (rediscover.ts) filters the pool before the ranker
//   write  record/reconcile alerts     (rediscovery-alert-store.ts) — the second wall
//   read   liveRediscoveryAlerts       (rediscover.ts) behind GET/POST
//                                      /api/rediscovery/alerts — the feed AND its `count`
//   act    POST /api/jobs/[id]/candidates/outreach — the Reach-out send door
//
// It used to be answered three ways: the rank gate composed consent + opt-out inline,
// the alert write wall checked consent only, and the feed read checked neither — so an
// opted-out, erased or lapsed person kept an "Add to pipeline" row in the shared feed
// for up to 90 days.
//
// The composition is DEFINED in rediscovery-alert-store.ts (its write wall needs it, and
// this module importing the store while the store imported this module would be a
// cycle). This is the canonical import site; nothing outside the store calls
// suppressedCandidateIds + optedOutCandidateIds as a pair.
export { withheldCandidateIds, type WithheldReason } from "./rediscovery-alert-store";
