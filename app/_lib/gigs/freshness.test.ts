// Freshness (freshness.ts + adapters/freelancer.ts): the Freelancer "projects by id" read,
// its classification, and what an answer does to gigs - on an isolated throwaway DB with a
// scripted fetch. unit-db.ts must be the first project import.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { getGig, listGigsForFreshness, setGigSourceState, transitionGig, upsertGigFromRaw } from "../db/gigs.ts";
import type { FetchOutcome, PoliteFetch, PoliteFetchOptions } from "../jobseeker/fetch/politeFetch.ts";
import { freelancerProjectIdOf, freelancerProjectState, readFreelancerProjectStates } from "./adapters/freelancer.ts";
import { checkGigStillOpen, refreshFreelancerGigStates, type GigFreshnessDeps } from "./freshness.ts";
import type { GigStatus, RawGig } from "./types.ts";

after(() => cleanupUnitDb());

const NOW = "2026-09-30T10:00:00.000Z";
const ok = (body: unknown): FetchOutcome => ({ kind: "ok", status: 200, contentType: "application/json", body: JSON.stringify(body), finalUrl: "", stream: null });
const projects = (...ps: object[]) => ok({ status: "success", result: { projects: ps } });

function scripted(answer: (url: string) => FetchOutcome) {
  const calls: { url: string; opts: PoliteFetchOptions }[] = [];
  const fetch: PoliteFetch = async (url, opts) => {
    calls.push({ url, opts });
    return answer(url);
  };
  return { fetch, calls };
}

function deps(fetch: PoliteFetch, now = NOW): GigFreshnessDeps {
  return { fetch, env: () => undefined, now: () => now, listGigsForFreshness, setGigSourceState, transitionGig };
}

let seq = 40_000_000;
function gig(ws: string, status: GigStatus = "new", key?: string) {
  seq += 1;
  const raw: RawGig = {
    externalKey: key ?? `fl:${seq}`,
    url: `https://www.freelancer.com/projects/${seq}`,
    title: `Project ${seq}`,
    org: null,
    reward: null,
    deadlineAt: null,
    postedAt: null,
    bodyText: "Build a thing.",
    bodyHtml: null,
    tags: [],
  };
  const g = upsertGigFromRaw(ws, { sourceId: "gsrc-fl", arena: "freelance", raw, suspectReasons: [] }).gig;
  const path: Partial<Record<GigStatus, GigStatus[]>> = {
    new: [],
    qualified: ["qualified"],
    dispatched: ["qualified", "dispatched"],
    drafted: ["qualified", "dispatched", "drafted"],
    in_review: ["qualified", "dispatched", "drafted", "in_review"],
  };
  let from: GigStatus = "new";
  for (const to of path[status] ?? []) {
    assert.ok(transitionGig(ws, g.id, { from, to }).ok, `${from} -> ${to}`);
    from = to;
  }
  return getGig(ws, g.id)!;
}

test("classification: open, awarded, frozen, other closed, deleted; bid count kept", () => {
  assert.deepEqual(freelancerProjectState({ status: "active", frontend_project_status: "open", bid_stats: { bid_count: 249 } }, NOW), {
    state: "open",
    detail: "active",
    bidCount: 249,
    checkedAt: NOW,
  });
  assert.equal(freelancerProjectState({ status: "closed", sub_status: "closed_awarded", frontend_project_status: "work_in_progress" }, NOW).state, "awarded");
  const frozen = freelancerProjectState({ status: "frozen", sub_status: "frozen_timeout", frontend_project_status: "open" }, NOW);
  assert.equal(frozen.state, "frozen");
  assert.equal(frozen.detail, "frozen_timeout");
  assert.equal(freelancerProjectState({ status: "closed", sub_status: "closed_expired" }, NOW).state, "closed");
  assert.equal(freelancerProjectState({ status: "active", deleted: true }, NOW).state, "gone");
  assert.equal(freelancerProjectIdOf("fl:40731878"), 40731878);
  assert.equal(freelancerProjectIdOf("gh:123"), null);
  assert.equal(freelancerProjectIdOf("fl:abc"), null);
});

test("the read: one request per batch, an id the API leaves out is gone, a failed read claims nothing", async () => {
  const { fetch, calls } = scripted(() => projects({ id: 1, status: "active", frontend_project_status: "open" }));
  const res = await readFreelancerProjectStates([1, 2, 2], { fetch, env: () => undefined, sourceId: "gsrc-fl", now: () => NOW });
  assert.ok(res.ok);
  if (!res.ok) return;
  assert.equal(res.states.get(1)?.state, "open");
  assert.equal(res.states.get(2)?.state, "gone", "absent from a successful answer = gone");
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/api/projects/0.1/projects/");
  assert.deepEqual(url.searchParams.getAll("projects[]"), ["1", "2"], "deduplicated ids");

  const blocked = scripted(() => ({ kind: "blocked", status: 403, detail: "denied" }));
  assert.deepEqual(await readFreelancerProjectStates([1], { fetch: blocked.fetch, env: () => undefined, sourceId: "s", now: () => NOW }), { ok: false, reason: "blocked" });
  const moved = scripted(() => ok({ status: "error" }));
  assert.deepEqual(await readFreelancerProjectStates([1], { fetch: moved.fetch, env: () => undefined, sourceId: "s", now: () => NOW }), {
    ok: false,
    reason: "shape_changed",
  });
});

test("refresh: records every answer; a waiting gig on a closed listing expires, work further along keeps its status", async () => {
  const WS = "ws-fresh-1";
  const open = gig(WS, "new");
  const awardedNew = gig(WS, "new");
  const goneQualified = gig(WS, "qualified");
  const frozenReview = gig(WS, "in_review");
  const idOf = (g: { externalKey: string }) => freelancerProjectIdOf(g.externalKey)!;
  const { fetch, calls } = scripted(() =>
    projects(
      { id: idOf(open), status: "active", frontend_project_status: "open", bid_stats: { bid_count: 12 } },
      { id: idOf(awardedNew), status: "closed", sub_status: "closed_awarded" },
      { id: idOf(frozenReview), status: "frozen", sub_status: "frozen_timeout" }
    )
  );
  const before = getGig(WS, open.id)!.updatedAt;
  const sum = await refreshFreelancerGigStates(WS, deps(fetch));
  assert.deepEqual(sum, { checked: 4, open: 1, closed: 2, gone: 1, expired: 2, failed: null });
  assert.equal(calls.length, 1, "one batch");
  assert.equal(getGig(WS, open.id)!.status, "new");
  assert.equal(getGig(WS, open.id)!.sourceState?.bidCount, 12);
  assert.equal(getGig(WS, open.id)!.updatedAt, before, "recording a state does not move the desk sort key");
  assert.equal(getGig(WS, awardedNew.id)!.status, "expired");
  assert.equal(getGig(WS, goneQualified.id)!.status, "expired");
  assert.equal(getGig(WS, goneQualified.id)!.sourceState?.state, "gone");
  const review = getGig(WS, frozenReview.id)!;
  assert.equal(review.status, "in_review", "work under review is the operator's to judge");
  assert.equal(review.sourceState?.state, "frozen");
});

test("refresh: a failed read stops the pass and writes nothing; least recently checked goes first", async () => {
  const WS = "ws-fresh-2";
  const a = gig(WS, "new");
  const b = gig(WS, "new");
  const down = scripted(() => ({ kind: "offline", detail: "KP_OFFLINE" }));
  const sum = await refreshFreelancerGigStates(WS, deps(down.fetch));
  assert.deepEqual(sum, { checked: 0, open: 0, closed: 0, gone: 0, expired: 0, failed: "offline" });
  assert.equal(getGig(WS, a.id)!.sourceState, null, "no answer, no state");
  assert.equal(getGig(WS, a.id)!.status, "new", "and nothing expires on a failure");

  setGigSourceState(WS, a.id, { state: "open", detail: "active", bidCount: 1, checkedAt: "2026-09-29T00:00:00.000Z" });
  const order = listGigsForFreshness(WS, { keyPrefix: "fl:", statuses: ["new"], limit: 10 }).map((g) => g.id);
  assert.deepEqual(order, [b.id, a.id], "never checked before checked");
  assert.deepEqual(listGigsForFreshness(WS, { keyPrefix: "gh:", statuses: ["new"], limit: 10 }), [], "another key space");
  assert.deepEqual(listGigsForFreshness("ws-other", { keyPrefix: "fl:", statuses: ["new"], limit: 10 }), [], "tenant-scoped");
});

test("checkGigStillOpen: a fresh answer is reused, a stale one re-read; not a Freelancer key = not asked", async () => {
  const WS = "ws-fresh-3";
  const g = gig(WS, "qualified");
  const id = freelancerProjectIdOf(g.externalKey)!;
  const awarded = scripted(() => projects({ id, status: "closed", sub_status: "closed_awarded" }));
  const first = await checkGigStillOpen(WS, g, deps(awarded.fetch));
  assert.equal(first.checked, true);
  assert.equal(first.state?.state, "awarded");
  assert.equal(getGig(WS, g.id)!.status, "expired");

  const h = gig(WS, "qualified");
  setGigSourceState(WS, h.id, { state: "open", detail: "active", bidCount: 3, checkedAt: "2026-09-30T08:00:00.000Z" });
  const never = scripted(() => {
    throw new Error("must not be asked");
  });
  const cached = await checkGigStillOpen(WS, getGig(WS, h.id)!, deps(never.fetch), 6 * 3_600_000);
  assert.deepEqual(cached, { checked: false, state: getGig(WS, h.id)!.sourceState });
  assert.equal(never.calls.length, 0, "2 hours old < 6 hour TTL");

  const other = gig(WS, "qualified", "gh:77");
  assert.equal((await checkGigStillOpen(WS, other, deps(never.fetch))).checked, false);

  const offline = scripted(() => ({ kind: "offline", detail: "KP_OFFLINE" }));
  const i = gig(WS, "qualified");
  const res = await checkGigStillOpen(WS, i, deps(offline.fetch));
  assert.deepEqual(res, { checked: false, state: null, failed: "offline" });
  assert.equal(getGig(WS, i.id)!.status, "qualified", "an unanswered check never expires");
});
