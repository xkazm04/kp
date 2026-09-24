// Behaviour of the gig outcome + lesson store on an isolated throwaway DB - unit-db.ts
// must be the first project import. Also pins gig_outcomes as APPEND-ONLY at the source.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { foldGigKpi } from "../gigs/kpi.ts";
import * as outcomesStore from "./gigs-outcomes.ts";
import {
  appendGigLesson,
  appendGigOutcome,
  listGigOutcomes,
  listPendingGigLessons,
  markGigLessonsLanded,
  readGigKpiInput,
} from "./gigs-outcomes.ts";
import { createGigAttempt, transitionGigAttempt } from "./gigs-attempts.ts";
import { upsertGigFromRaw } from "./gigs.ts";
import { createGigSpecialist } from "./gigs-specialists.ts";

after(() => cleanupUnitDb());

const WS = "ws-gig-outcomes";
const OTHER = "ws-gig-outcomes-other";

let seq = 0;
function gig(ws = WS, arena: "security" | "oss_bounty" = "oss_bounty") {
  seq += 1;
  return upsertGigFromRaw(ws, {
    sourceId: "gsrc",
    arena,
    raw: {
      externalKey: `k-${seq}`,
      url: `https://example.test/${seq}`,
      title: `Gig ${seq}`,
      org: null,
      reward: null,
      deadlineAt: null,
      postedAt: null,
      bodyText: "Do the thing.",
      bodyHtml: null,
      tags: [],
    },
    suspectReasons: [],
  }).gig;
}

function sentAttempt(ws: string, gigId: string, specialistId: string, costUsd: number | null, disclosure: boolean) {
  const a = createGigAttempt(ws, { gigId, specialistId, revisionNote: null })!;
  transitionGigAttempt(ws, a.id, { from: "dispatched", to: "drafted", patch: { costUsd } });
  transitionGigAttempt(ws, a.id, {
    from: "drafted",
    to: "approved",
    patch: { review: { checklist: { disclosure }, note: null, reviewMs: 5000, reviewedAt: "2026-09-24T00:00:00.000Z" } },
  });
  transitionGigAttempt(ws, a.id, { from: "approved", to: "sent", patch: { sentAt: new Date().toISOString() } });
  return a;
}

test("gig_outcomes is APPEND-ONLY: no source under app/_lib updates or deletes it, and the store exports no mutator", () => {
  const libDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules") walk(p, out);
      } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(p);
    }
    return out;
  };
  const offenders = walk(libDir).filter((f) => /\b(update|delete\s+from)\s+gig_outcomes\b/i.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders, [], "a statement mutates the append-only gig_outcomes table");
  const exported = Object.keys(outcomesStore).filter((k) => /outcome/i.test(k));
  assert.deepEqual(exported.sort(), ["appendGigOutcome", "listGigOutcomes"]);
  // Non-vacuity: the pattern does catch the shapes it forbids.
  assert.match("UPDATE gig_outcomes SET verdict = ?", /\b(update|delete\s+from)\s+gig_outcomes\b/i);
  assert.match("DELETE FROM gig_outcomes WHERE id = ?", /\b(update|delete\s+from)\s+gig_outcomes\b/i);
});

test("append: verdicts accumulate, the attempt must belong to the gig, another workspace is refused", () => {
  const g = gig();
  const a = sentAttempt(WS, g.id, "s1", 1, true);
  const o1 = appendGigOutcome(WS, { gigId: g.id, attemptId: a.id, verdict: "rejected", amount: null, currency: null, feedbackText: "  out of scope ", source: "manual" });
  const o2 = appendGigOutcome(WS, { gigId: g.id, attemptId: a.id, verdict: "accepted", amount: 250, currency: "USD", feedbackText: null, source: "poller:github" });
  assert.ok(o1 && o2);
  assert.equal(o1.feedbackText, "out of scope");
  assert.deepEqual(listGigOutcomes(WS, { gigId: g.id }).map((o) => o.verdict), ["rejected", "accepted"], "both rows kept, in order");

  const other = gig();
  assert.equal(
    appendGigOutcome(WS, { gigId: other.id, attemptId: a.id, verdict: "accepted", amount: null, currency: null, feedbackText: null, source: "manual" }),
    null,
    "an attempt of a different gig is refused"
  );
  assert.equal(
    appendGigOutcome(OTHER, { gigId: g.id, attemptId: null, verdict: "accepted", amount: null, currency: null, feedbackText: null, source: "manual" }),
    null
  );
  assert.deepEqual(listGigOutcomes(OTHER), []);
});

test("lessons: append, list pending, land once (the first landing date is kept)", () => {
  const g = gig();
  const o = appendGigOutcome(WS, { gigId: g.id, attemptId: null, verdict: "accepted", amount: null, currency: null, feedbackText: null, source: "manual" })!;
  const l = appendGigLesson(WS, {
    outcomeId: o.id,
    recipe: { slug: "oss-bounty-triage", version: "0.3.0" },
    arena: "oss_bounty",
    verdict: "accepted",
    bullets: ["  Reproduce before patching. ", "", "Link the failing test in the PR body."],
  });
  assert.ok(l);
  assert.deepEqual(l.bullets, ["Reproduce before patching.", "Link the failing test in the PR body."]);
  assert.deepEqual(l.recipe, { slug: "oss-bounty-triage", version: "0.3.0" });
  assert.equal(l.landedAt, null);
  assert.ok(listPendingGigLessons(WS).some((x) => x.id === l.id));

  assert.equal(markGigLessonsLanded(OTHER, [l.id]), 0, "another workspace cannot land it");
  assert.equal(markGigLessonsLanded(WS, [l.id, l.id]), 1);
  assert.equal(markGigLessonsLanded(WS, [l.id]), 0, "already landed");
  assert.ok(!listPendingGigLessons(WS).some((x) => x.id === l.id));
  assert.equal(markGigLessonsLanded(WS, []), 0);

  assert.equal(
    appendGigLesson(OTHER, { outcomeId: o.id, recipe: { slug: "x", version: "1" }, arena: "oss_bounty", verdict: "accepted", bullets: ["x"] }),
    null,
    "a lesson cannot hang off another workspace's outcome"
  );
});

test("readGigKpiInput gathers exactly this workspace's rows, and the fold reads them", () => {
  const ws = "ws-gig-outcomes-kpi";
  const spec = createGigSpecialist(ws, {
    hiredAgentId: "ha",
    name: "Sec",
    spec: { arena: "security", niche: "web", taxonomyFamily: "security", recipes: [], exemplars: [], connectors: [], budgetUsdPerAttempt: 1, promptVersion: "v1" },
    registry: "available",
  });
  const g1 = gig(ws, "security");
  const g2 = gig(ws, "security");
  const a1 = sentAttempt(ws, g1.id, spec.id, 2, true);
  sentAttempt(ws, g2.id, spec.id, null, false);
  appendGigOutcome(ws, { gigId: g1.id, attemptId: a1.id, verdict: "accepted", amount: 500, currency: "USD", feedbackText: null, source: "manual" });
  // Noise in another workspace must not leak in.
  const og = gig(OTHER, "security");
  sentAttempt(OTHER, og.id, spec.id, 100, true);

  const input = readGigKpiInput(ws, "2026-09-24T12:00:00.000Z");
  assert.equal(input.attempts.length, 2);
  assert.equal(input.gigs.length, 2);
  assert.equal(input.outcomes.length, 1);
  assert.deepEqual(input.specialists, [{ id: spec.id }]);

  const kpi = foldGigKpi(input);
  assert.equal(kpi.computedAt, "2026-09-24T12:00:00.000Z");
  assert.deepEqual(kpi.byArena.security, {
    resolved: 1,
    accepted: 1,
    rate: 1,
    pending: 1,
    costPerAcceptedUsd: 2,
    costUnreported: 1,
    smallSample: true,
  });
  assert.equal(kpi.disclosureRate, 0.5);
});
