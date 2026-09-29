# A contest door at the point of decision (closes the mechanism half of R-26)

Source: the registry technique `contest-door-at-the-point-of-decision`
(bulk-adverse-action-governance), written from an intake run of an open-source agent
platform (2026-09-29) whose escalation door is *declared per workflow node*, the opposite
of what a statutory request needs. Backlog row: `docs/features/compliance/regulatory-backlog.md` R-26.
Nothing below is built. This is the plan, with the branch step deliberately not taken.

## The seam

`messages/en.json` `decisions.humanReviewNote` promises "Just reply to any message from the
hiring team". kp has one receiver (`/api/channels/inbound/[token]`, lead intake) and no
inbound-email path (`app/_lib/comms-truth.ts`), so nothing records the request. The
Reconsider queue (`listReconsiderQueue`, `app/_lib/db/pipeline.ts`) takes machine rejections
only, by design, so it could not receive a request against a human rejection even if one
were recorded.

## What is missing (two mechanisms, one of them built)

1. **The door** (not built): a control on the token-gated status page beside each decision;
   a request row keyed to the sealed decision id (received-at, channel, the candidate's
   message and anything they attach, acknowledgement sent-at, due-at from a configured
   timescale, named contact from settings).
2. **The routing step** (not built): sealed actor automated (or undeterminable) -> the
   existing Reconsider queue with the request attached; sealed actor a named person -> a
   review request assigned to a user other than the decider. The queue itself stays as is.

## Size

About 8 files and 350-450 lines: one store (new table, additive DDL owned by its own
module), one public route under the status token, one status-page component, one settings
field pair (contact, timescale), the routing function, its tests, and the 12 locale strings
(the `i18n:check` gate applies). Not one reviewable diff if the routing and the door are
combined; split them.

## The measurable and the floor

Target: requests recorded per decision notice delivered (today: no numerator), with a
**found-late** count beside it (requests first seen through an unstructured channel and
later matched to a decision). Floor: no change to any existing reinstate or reconsider path
(`reinstatePipelineEntry` behaviour and the queue's membership rule pinned by their current
tests).

## The gate

`npm run typecheck`, `npm run test:unit` (new store and routing tests, plus the existing
reconsider-queue and tenancy tests), `npm run lint`, and the docs gate for the compliance
row. Diff the unit failures against the pre-existing baseline rather than reading a red run.

## First step (not taken)

The store and routing function with tests, no UI, behind no route. It is reviewable alone
and moves nothing a candidate can see. Not taken in this run: R-26 is the owner's backlog
row with a sequencing decision attached, and the tree's local main carries unpushed sibling
work.

## Decision the owner owns

Whether the notice keeps a reply-address promise at all once the door exists. Without an
inbound mail path the honest notice points at the control, which is a wording change in
every locale.
