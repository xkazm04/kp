// Outcome pollers (pollers.ts) on an isolated throwaway DB with injected GitHub and Kaggle
// transports - zero network. unit-db.ts first.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { getGig } from "../db/gigs.ts";
import { appendGigOutcome, listGigOutcomes } from "../db/gigs-outcomes.ts";
import type { FetchOutcome, PoliteFetchOptions } from "../jobseeker/fetch/politeFetch.ts";
import type { GithubReadOutcome } from "../repo-snapshot.ts";
import {
  hasPollableGigs,
  kaggleSlugOf,
  parsePullRef,
  pollGigOutcomes,
  pullRefsOf,
  pullStateOf,
  verdictFromKaggleSubmissions,
  verdictFromPulls,
  type GigPollerDeps,
} from "./pollers.ts";
import { fixtureDeliverable, fixtureSentGig, fixtureSpecialist } from "./__fixtures__/sent-gig.ts";

after(() => cleanupUnitDb());

const NOW = new Date("2026-09-24T12:00:00Z");

type Deps = GigPollerDeps & { githubCalls: string[]; fetchCalls: { url: string; opts: PoliteFetchOptions }[] };

function deps(opts: { pulls?: Record<string, GithubReadOutcome<unknown>>; kaggle?: FetchOutcome; env?: Record<string, string> } = {}): Deps {
  const githubCalls: string[] = [];
  const fetchCalls: { url: string; opts: PoliteFetchOptions }[] = [];
  return {
    githubCalls,
    fetchCalls,
    githubRead: async <T,>(url: string) => {
      githubCalls.push(url);
      return (opts.pulls?.[url] ?? { ok: false, kind: "not_found", status: 404 }) as GithubReadOutcome<T>;
    },
    fetch: async (url, o) => {
      fetchCalls.push({ url, opts: o });
      return opts.kaggle ?? { kind: "outage", status: 503, detail: "down" };
    },
    env: (name) => opts.env?.[name],
    now: () => NOW,
  };
}

const PR = "https://api.github.com/repos/acme/widgets/pulls/42";

test("parsePullRef: URLs and the short form; anything else is not polled", () => {
  assert.deepEqual(parsePullRef("https://github.com/acme/widgets/pull/42"), { owner: "acme", repo: "widgets", number: 42 });
  assert.deepEqual(parsePullRef("https://github.com/acme/widgets/pull/42/files?x=1"), { owner: "acme", repo: "widgets", number: 42 });
  assert.deepEqual(parsePullRef("acme/widgets#7"), { owner: "acme", repo: "widgets", number: 7 });
  for (const bad of ["https://gitlab.com/a/b/-/merge_requests/1", "https://github.com/acme/widgets/issues/42", "acme/../x#1", "https://github.com/acme/widgets/pull/0", "nope"]) {
    assert.equal(parsePullRef(bad), null, bad);
  }
  const refs = pullRefsOf({
    deliverable: fixtureDeliverable({
      artifacts: [
        { kind: "pr", ref: "https://github.com/acme/widgets/pull/42", title: "a" },
        { kind: "pr", ref: "acme/widgets#42", title: "same PR, short form" },
        { kind: "file", ref: "https://github.com/acme/widgets/pull/43", title: "not a pr artifact" },
      ],
    }),
  });
  assert.deepEqual(refs, [{ owner: "acme", repo: "widgets", number: 42 }]);
});

test("the PR state table and the verdict over several PRs", () => {
  assert.equal(pullStateOf({ state: "closed", merged: true }), "merged");
  assert.equal(pullStateOf({ state: "closed", merged_at: "2026-09-20T00:00:00Z" }), "merged");
  assert.equal(pullStateOf({ state: "closed", merged: false }), "closed");
  assert.equal(pullStateOf({ state: "open" }), "open");
  assert.equal(pullStateOf(null), "unreadable");
  assert.deepEqual(verdictFromPulls(["closed", "merged"]), { verdict: "accepted", unreadable: false });
  assert.deepEqual(verdictFromPulls(["closed", "closed"]), { verdict: "rejected", unreadable: false });
  assert.deepEqual(verdictFromPulls(["closed", "open"]), { verdict: null, unreadable: false });
  assert.deepEqual(verdictFromPulls(["closed", "unreadable"]), { verdict: null, unreadable: true });
});

test("the Kaggle submissions table: both API eras, scored vs errored vs nothing yet", () => {
  assert.deepEqual(verdictFromKaggleSubmissions([{ status: "complete", privateScore: "0.8123" }]), { verdict: "accepted", unreadable: false });
  assert.deepEqual(verdictFromKaggleSubmissions({ submissions: [{ status: "SubmissionStatus.COMPLETE", privateScore: 0.5 }] }), { verdict: "accepted", unreadable: false });
  assert.deepEqual(verdictFromKaggleSubmissions([{ status: "complete", privateScore: "" }]), { verdict: null, unreadable: false }, "no private score yet");
  assert.deepEqual(verdictFromKaggleSubmissions([{ status: "error" }, { status: "ERROR" }]), { verdict: "rejected", unreadable: false });
  assert.deepEqual(verdictFromKaggleSubmissions([]), { verdict: null, unreadable: false });
  assert.deepEqual(verdictFromKaggleSubmissions({ weird: true }), { verdict: null, unreadable: true });
  assert.equal(kaggleSlugOf({ url: "https://www.kaggle.com/competitions/titanic", externalKey: "x" }), "titanic");
  assert.equal(kaggleSlugOf({ url: "https://example.test", externalKey: "kaggle:house-prices" }), "house-prices");
  assert.equal(kaggleSlugOf({ url: "https://example.test", externalKey: "manual:abc" }), null);
});

test("GitHub: a merged PR resolves the sent gig as accepted, once", async () => {
  const ws = "ws-poll-merged";
  const spec = fixtureSpecialist(ws, "oss_bounty");
  const { gig, attempt } = fixtureSentGig(ws, spec);
  assert.equal(hasPollableGigs(ws), true);
  const d = deps({ pulls: { [PR]: { ok: true, data: { state: "closed", merged: true } } } });
  const s = await pollGigOutcomes(ws, d);
  assert.deepEqual(s, { checked: 1, accepted: 1, rejected: 0, pending: 0, skipped: 0, unreadable: 0 });
  assert.deepEqual(d.githubCalls, [PR]);
  const outcomes = listGigOutcomes(ws, { gigId: gig.id });
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].source, "poller:github");
  assert.equal(outcomes[0].attemptId, attempt.id);
  assert.equal(outcomes[0].amount, null, "a merge is not proof of payment");
  assert.equal(getGig(ws, gig.id)!.status, "accepted");
  // The next tick asks nothing: the gig left `sent`.
  const again = await pollGigOutcomes(ws, d);
  assert.equal(again.checked, 0);
  assert.equal(listGigOutcomes(ws, { gigId: gig.id }).length, 1);
  assert.equal(hasPollableGigs(ws), false);
});

test("GitHub: closed unmerged -> rejected; open -> pending; throttled -> unreadable; no PR -> skipped", async () => {
  const ws = "ws-poll-mixed";
  const spec = fixtureSpecialist(ws, "oss_bounty");
  const closed = fixtureSentGig(ws, spec, { deliverable: fixtureDeliverable({ artifacts: [{ kind: "pr", ref: "acme/widgets#1", title: "x" }] }) });
  const open = fixtureSentGig(ws, spec, { deliverable: fixtureDeliverable({ artifacts: [{ kind: "pr", ref: "acme/widgets#2", title: "x" }] }) });
  const throttled = fixtureSentGig(ws, spec, { deliverable: fixtureDeliverable({ artifacts: [{ kind: "pr", ref: "acme/widgets#3", title: "x" }] }) });
  const noPr = fixtureSentGig(ws, spec, { deliverable: fixtureDeliverable({ artifacts: [{ kind: "text", ref: "inline", title: "x" }] }) });
  const base = "https://api.github.com/repos/acme/widgets/pulls/";
  const d = deps({
    pulls: {
      [`${base}1`]: { ok: true, data: { state: "closed", merged: false } },
      [`${base}2`]: { ok: true, data: { state: "open", merged: false } },
      [`${base}3`]: { ok: false, kind: "throttled", status: 403 },
    },
  });
  const s = await pollGigOutcomes(ws, d);
  assert.deepEqual(s, { checked: 3, accepted: 0, rejected: 1, pending: 1, skipped: 1, unreadable: 1 });
  assert.equal(getGig(ws, closed.gig.id)!.status, "rejected");
  for (const g of [open, throttled, noPr]) {
    assert.equal(getGig(ws, g.gig.id)!.status, "sent");
    assert.equal(listGigOutcomes(ws, { gigId: g.gig.id }).length, 0, "no verdict is ever invented from an unreadable or undecided answer");
  }
});

test("idempotent: an attempt a poller already judged is never judged again", async () => {
  const ws = "ws-poll-idem";
  const spec = fixtureSpecialist(ws, "oss_bounty");
  const { gig, attempt } = fixtureSentGig(ws, spec);
  // A poller verdict exists while the gig is still `sent` (its status move was lost).
  appendGigOutcome(ws, { gigId: gig.id, attemptId: attempt.id, verdict: "accepted", amount: null, currency: null, feedbackText: null, source: "poller:github" });
  const d = deps({ pulls: { [PR]: { ok: true, data: { state: "closed", merged: true } } } });
  const s = await pollGigOutcomes(ws, d);
  assert.equal(s.skipped, 1);
  assert.equal(d.githubCalls.length, 0);
  assert.equal(listGigOutcomes(ws, { gigId: gig.id }).length, 1);
});

test("Kaggle: no key is a no-op (no request, no outcome); before the deadline nothing is final", async () => {
  const ws = "ws-poll-kaggle-nokey";
  const spec = fixtureSpecialist(ws, "competition");
  const { gig } = fixtureSentGig(ws, spec, {
    arena: "competition",
    url: "https://www.kaggle.com/competitions/titanic",
    externalKey: "kaggle:titanic",
    deadlineAt: "2026-09-01T00:00:00Z",
  });
  const noKey = deps({ kaggle: { kind: "ok", status: 200, contentType: "application/json", body: "[]", finalUrl: "", stream: null } });
  const s1 = await pollGigOutcomes(ws, noKey);
  assert.deepEqual(s1, { checked: 0, accepted: 0, rejected: 0, pending: 0, skipped: 1, unreadable: 0 });
  assert.equal(noKey.fetchCalls.length, 0);

  const ws2 = "ws-poll-kaggle-early";
  const spec2 = fixtureSpecialist(ws2, "competition");
  fixtureSentGig(ws2, spec2, { arena: "competition", externalKey: "kaggle:future", deadlineAt: "2026-12-01T00:00:00Z" });
  const keyed = deps({ env: { KAGGLE_USERNAME: "op", KAGGLE_KEY: "k" } });
  const s2 = await pollGigOutcomes(ws2, keyed);
  assert.equal(s2.skipped, 1);
  assert.equal(keyed.fetchCalls.length, 0);
  assert.equal(getGig(ws, gig.id)!.status, "sent");
});

test("Kaggle: after the deadline, a scored entry is accepted; every submission errored is rejected", async () => {
  const ws = "ws-poll-kaggle";
  const spec = fixtureSpecialist(ws, "competition");
  const scored = fixtureSentGig(ws, spec, { arena: "competition", externalKey: "kaggle:titanic", url: "https://www.kaggle.com/competitions/titanic", deadlineAt: "2026-09-01T00:00:00Z" });
  const ok = (body: unknown): FetchOutcome => ({ kind: "ok", status: 200, contentType: "application/json", body: JSON.stringify(body), finalUrl: "", stream: null });
  const d = deps({ env: { KAGGLE_USERNAME: "op", KAGGLE_KEY: "secret-key" }, kaggle: ok([{ status: "complete", privateScore: "0.79" }]) });
  const s = await pollGigOutcomes(ws, d);
  assert.equal(s.accepted, 1);
  assert.equal(d.fetchCalls.length, 1);
  assert.equal(d.fetchCalls[0].url, "https://www.kaggle.com/api/v1/competitions/submissions/list/titanic?page=1");
  assert.match(d.fetchCalls[0].opts.authorization ?? "", /^Basic /, "the key rides as basic auth through the polite door");
  assert.equal(getGig(ws, scored.gig.id)!.status, "accepted");
  assert.equal(listGigOutcomes(ws, { gigId: scored.gig.id })[0].source, "poller:kaggle");

  const ws2 = "ws-poll-kaggle-err";
  const spec2 = fixtureSpecialist(ws2, "competition");
  const errored = fixtureSentGig(ws2, spec2, { arena: "competition", externalKey: "kaggle:house", deadlineAt: "2026-09-01T00:00:00Z" });
  const d2 = deps({ env: { KAGGLE_USERNAME: "op", KAGGLE_KEY: "k" }, kaggle: ok({ submissions: [{ status: "ERROR" }] }) });
  assert.equal((await pollGigOutcomes(ws2, d2)).rejected, 1);
  assert.equal(getGig(ws2, errored.gig.id)!.status, "rejected");

  const ws3 = "ws-poll-kaggle-down";
  const spec3 = fixtureSpecialist(ws3, "competition");
  fixtureSentGig(ws3, spec3, { arena: "competition", externalKey: "kaggle:down", deadlineAt: "2026-09-01T00:00:00Z" });
  const d3 = deps({ env: { KAGGLE_USERNAME: "op", KAGGLE_KEY: "k" } }); // outage
  assert.equal((await pollGigOutcomes(ws3, d3)).unreadable, 1);
});
