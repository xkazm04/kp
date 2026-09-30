// The reward-rules purge (gigs/purge.ts over db/gigs-purge.ts) on an isolated DB. Proves: a
// dry run writes nothing and answers what a real run would delete; a real run deletes each
// matched gig with its plans, attempts and persona rows; a gig with an outcome, a gig above
// the floor and another workspace's gig are never touched; a live persona is retired AFTER the
// delete and its row dropped, a refused retire leaves the row for the sync; no rate table =
// a non-USD reward is kept; the store's transaction awaits nothing.
//
// unit-db.ts must be the first project import (it sets KP_DB_PATH before any store opens).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHiredAgent, getHiredAgent, updateHiredAgentStatus } from "../db/agents.ts";
import { getGig, upsertGigFromRaw } from "../db/gigs.ts";
import { createGigAttempt, listGigAttemptsForGig } from "../db/gigs-attempts.ts";
import { appendGigOutcome } from "../db/gigs-outcomes.ts";
import { createGigPlanRound, listGigPlans } from "../db/gigs-plans.ts";
import { createGigSpecialist, getGigSpecialist } from "../db/gigs-specialists.ts";
import type { FxTable } from "./fx.ts";
import { retireGigPersonaHire } from "./persona-retire.ts";
import { runGigPurge, type GigPurgeDeps } from "./purge.ts";
import type { GigArena, GigReward } from "./types.ts";

after(() => cleanupUnitDb());

const TABLE: FxTable = { rates: { INR: { rate: 95.92, date: "2026-09-30" } }, fetchedAt: "2026-09-30T07:00:00.000Z", source: "test" };
let seq = 0;
function gig(ws: string, arena: GigArena, reward: GigReward | null) {
  seq += 1;
  return upsertGigFromRaw(ws, {
    sourceId: "gsrc-p",
    arena,
    raw: { externalKey: `p-${seq}`, url: `https://example.test/p/${seq}`, title: `Purge ${seq}`, org: null, reward, deadlineAt: null, postedAt: null, bodyText: "x", bodyHtml: null, tags: [] },
    suspectReasons: [],
  }).gig;
}
function persona(ws: string, gigId: string, personaId: string | null) {
  const agent = createHiredAgent({ jobTitle: "Gig persona - test", spec: {} }, ws);
  updateHiredAgentStatus(agent.id, "active", { personaId }, ws);
  return createGigSpecialist(ws, {
    hiredAgentId: agent.id,
    name: "P",
    spec: { arena: "oss_bounty", niche: "web", taxonomyFamily: "software_engineering", recipes: [], exemplars: [], connectors: [], budgetUsdPerAttempt: 5, promptVersion: "gig-requirements.v1" },
    registry: "unavailable",
    gigId,
  });
}
const usd = (text: string, amount: number): GigReward => ({ amount, currency: "USD", text });
const SEATS = [{ seat: "opus" as const, model: "claude-opus-5-5", effort: null }];
function deps(over: Partial<GigPurgeDeps> = {}): GigPurgeDeps & { fxReads: number; logs: string[] } {
  const d = {
    fxReads: 0,
    logs: [] as string[],
    fxRates: async () => {
      d.fxReads += 1;
      return TABLE;
    },
    retire: (ws: string, agent: Parameters<typeof retireGigPersonaHire>[1], reason: string) => retireGigPersonaHire(ws, agent, reason, async () => ({ ok: true, already: false })),
    log: (line: string) => void d.logs.push(line),
    ...over,
  };
  return d;
}

test("dry run: counts by rule, status and arena, the children and the files - and writes nothing", async () => {
  const WS = "ws-dry";
  const none = gig(WS, "security", null);
  const tiny = gig(WS, "freelance", usd("$10-$30 USD", 10));
  const inr = gig(WS, "freelance", { amount: 600, currency: "INR", text: "₹600-₹1,500 INR" });
  gig(WS, "freelance", usd("$30-$250 USD", 30));
  createGigPlanRound(WS, none.id, SEATS);
  createGigAttempt(WS, { gigId: none.id, specialistId: "gspec-x", revisionNote: null });
  const d = deps();
  const r = await runGigPurge(WS, { rules: ["no_reward", "below_floor"], dryRun: true }, d);
  assert.equal(r.dryRun, true);
  assert.equal(r.count, 3);
  assert.deepEqual(r.byRule, { no_reward: 1, below_floor: 2 });
  assert.deepEqual(r.byArena, { security: 1, freelance: 2 });
  assert.deepEqual(r.byStatus, { new: 3 });
  assert.deepEqual(r.sample.map((s) => s.id), [none.id, tiny.id, inr.id]);
  assert.deepEqual([r.children.plans, r.children.attempts, r.fx, d.fxReads], [1, 1, "read", 1]);
  assert.equal(r.deleted, undefined);
  for (const g of [none, tiny, inr]) assert.ok(getGig(WS, g.id), "a dry run deletes nothing");
  assert.equal(listGigPlans(WS, none.id).length, 1);

  const onlyNone = await runGigPurge(WS, { rules: ["no_reward"], dryRun: true }, d);
  assert.deepEqual([onlyNone.count, onlyNone.fx, d.fxReads], [1, "not_needed", 1], "no floor rule, no rate table");
  const offline = await runGigPurge(WS, { rules: ["below_floor"], dryRun: true }, deps({ fxRates: async () => null }));
  assert.deepEqual([offline.count, offline.unconverted, offline.fx], [1, 1, "unavailable"], "no rate: the INR gig is kept, never guessed");
});

test("real run: gigs and their children go; an outcome, a gig above the floor and another workspace stay", async () => {
  const WS = "ws-real";
  const OTHER = "ws-real-other";
  const drafted = gig(WS, "oss_bounty", null);
  createGigPlanRound(WS, drafted.id, SEATS);
  createGigAttempt(WS, { gigId: drafted.id, specialistId: "gspec-y", revisionNote: null });
  const judged = gig(WS, "oss_bounty", null);
  appendGigOutcome(WS, { gigId: judged.id, attemptId: null, verdict: "rejected", amount: null, currency: null, feedbackText: null, source: "manual" });
  const keep = gig(WS, "freelance", usd("$30-$250 USD", 30));
  const hourly = gig(WS, "freelance", usd("$2-$8/hr USD", 2));
  const foreign = gig(OTHER, "security", null);

  const r = await runGigPurge(WS, { rules: ["no_reward", "below_floor"], dryRun: false }, deps());
  assert.deepEqual([r.count, r.deleted, r.keptWithOutcome, r.changed], [3, 2, 1, 0]);
  assert.equal(getGig(WS, drafted.id), null);
  assert.equal(getGig(WS, hourly.id), null);
  assert.deepEqual(listGigPlans(WS, drafted.id), []);
  assert.deepEqual(listGigAttemptsForGig(WS, drafted.id), []);
  assert.ok(getGig(WS, judged.id), "a judged gig is never deleted: the outcomes are append-only");
  assert.ok(getGig(WS, keep.id));
  assert.ok(getGig(OTHER, foreign.id), "another workspace's gig is never touched");

  const again = await runGigPurge(WS, { rules: ["no_reward", "below_floor"], dryRun: false }, deps());
  assert.deepEqual([again.count, again.deleted], [1, 0], "idempotent: only the judged gig still matches");
});

test("personas: a live one is retired after the delete and its row dropped; a refused retire leaves the row for the sync", async () => {
  const WS = "ws-personas";
  const a = gig(WS, "oss_bounty", null);
  const b = gig(WS, "oss_bounty", null);
  const pa = persona(WS, a.id, "per-a");
  const pb = persona(WS, b.id, "per-b");
  const seen: string[] = [];
  const r = await runGigPurge(WS, { rules: ["no_reward"], dryRun: false }, deps({
    retire: (ws, agent, reason) =>
      retireGigPersonaHire(ws, agent, reason, async (id) => {
        seen.push(id);
        return id === "per-a" ? { ok: true, already: false } : { ok: false, reason: "personas_unreachable" };
      }),
  }));
  assert.deepEqual([r.deleted, r.children.personas, r.personasRetired, r.personasFailed], [2, 2, 1, 1]);
  assert.deepEqual(seen.sort(), ["per-a", "per-b"]);
  assert.equal(getHiredAgent(pa.hiredAgentId, WS)?.status, "retired");
  assert.equal(getGigSpecialist(WS, pa.id), null, "a retired persona's row goes");
  assert.equal(getHiredAgent(pb.hiredAgentId, WS)?.status, "active");
  assert.ok(getGigSpecialist(WS, pb.id), "a refused retire keeps the row: the sync retries it as gig_missing");
});

test("the store's delete is one synchronous IMMEDIATE transaction per batch, and binds the workspace", () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "db", "gigs-purge.ts"), "utf8");
  const body = src.slice(src.indexOf("d.transaction("), src.indexOf("run.immediate()"));
  assert.ok(body.length > 100);
  assert.doesNotMatch(body, /\bawait\b|\basync\b/, "nothing is awaited inside the transaction");
  assert.match(src, /run\.immediate\(\)/);
});
