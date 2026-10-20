// Test fixtures for the WP4 gig tests (review, outcome, pollers, routes): a gig driven
// through the real stores to `drafted` or `sent`, with a specialist whose hire is live.
// Imported by *.test.ts only; every write goes through the WP1 stores, never raw SQL.

import { createHiredAgent, updateHiredAgentStatus, type AgentStatus } from "../../db/agents";
import { transitionGig, upsertGigFromRaw } from "../../db/gigs";
import { createGigAttempt, transitionGigAttempt } from "../../db/gigs-attempts";
import { createGigSpecialist } from "../../db/gigs-specialists";
import { gigRecipeSlugs } from "../recipes";
import type { Gig, GigArena, GigAttempt, GigDeliverable, GigReview, GigSpecialist } from "../types";

let seq = 0;

export function fixtureSpecialist(ws: string, arena: GigArena, agentStatus: AgentStatus = "active", personaId: string | null = "persona-fx"): GigSpecialist {
  const agent = createHiredAgent({ jobTitle: "Gig specialist - fixture", spec: {} }, ws);
  updateHiredAgentStatus(agent.id, agentStatus, { personaId }, ws);
  return createGigSpecialist(ws, {
    hiredAgentId: agent.id,
    name: "Fixture specialist",
    spec: {
      arena,
      niche: `fx-${agent.id}`,
      taxonomyFamily: "software_engineering",
      recipes: gigRecipeSlugs(arena).map((slug) => ({ slug, version: "0.1.0" })),
      exemplars: [],
      connectors: [],
      budgetUsdPerAttempt: 3,
      promptVersion: "gig-specialist.v1",
    },
    registry: "unavailable",
  });
}

export type FixtureGigOptions = {
  arena?: GigArena;
  sourceId?: string;
  org?: string | null;
  url?: string;
  externalKey?: string;
  deadlineAt?: string | null;
};

export function fixtureGig(ws: string, opts: FixtureGigOptions = {}): Gig {
  seq += 1;
  return upsertGigFromRaw(ws, {
    sourceId: opts.sourceId ?? "gsrc-fixture",
    arena: opts.arena ?? "oss_bounty",
    raw: {
      externalKey: opts.externalKey ?? `fx-${seq}-${Math.random().toString(36).slice(2, 8)}`,
      url: opts.url ?? `https://example.test/gig/${seq}`,
      title: `Fixture gig ${seq}`,
      org: opts.org === undefined ? "Acme Robotics" : opts.org,
      reward: { amount: 300, currency: "USD", text: "$300" },
      deadlineAt: opts.deadlineAt ?? null,
      postedAt: null,
      bodyText: `Fix the flaky test ${seq}.`,
      bodyHtml: null,
      tags: [],
    },
    suspectReasons: [],
  }).gig;
}

export function fixtureDeliverable(over: Partial<GigDeliverable> = {}): GigDeliverable {
  return {
    version: 1,
    summary: "Fixed the flaky test by awaiting the server.",
    draftText: "This PR fixes the flaky test.",
    artifacts: [{ kind: "pr", ref: "https://github.com/acme/widgets/pull/42", title: "Fix flaky test" }],
    evidence: [{ kind: "test", command: "npm test", result: "12 passed", passed: true }],
    disclosure: "Prepared with the assistance of an AI agent and reviewed by me.",
    confidence: 0.7,
    questions: [],
    ...over,
  };
}

export function fixtureReview(ticks: Record<string, boolean>): GigReview {
  return { checklist: ticks, note: null, reviewMs: 90_000, reviewedAt: new Date().toISOString() };
}

function must<R extends { ok: boolean }>(r: R, what: string): Extract<R, { ok: true }> {
  if (!r.ok) throw new Error(`${what}: ${JSON.stringify(r)}`);
  return r as Extract<R, { ok: true }>;
}

/** A gig whose attempt landed a draft: gig `drafted`, attempt `drafted`. */
export function fixtureDraftedGig(
  ws: string,
  specialist: GigSpecialist,
  opts: FixtureGigOptions & { deliverable?: GigDeliverable } = {}
): { gig: Gig; attempt: GigAttempt } {
  const gig = fixtureGig(ws, { arena: specialist.spec.arena, ...opts });
  must(transitionGig(ws, gig.id, { from: "new", to: "qualified", patch: { specialistId: specialist.id } }), "qualify");
  must(transitionGig(ws, gig.id, { from: "qualified", to: "dispatched" }), "dispatch");
  const attempt = createGigAttempt(ws, { gigId: gig.id, specialistId: specialist.id, revisionNote: null });
  if (!attempt) throw new Error("attempt not created");
  const drafted = must(
    transitionGigAttempt(ws, attempt.id, { from: "dispatched", to: "drafted", patch: { deliverable: opts.deliverable ?? fixtureDeliverable(), costUsd: 0.4 } }),
    "draft"
  );
  const g = must(transitionGig(ws, gig.id, { from: "dispatched", to: "drafted" }), "gig drafted");
  return { gig: g.gig, attempt: drafted.attempt };
}

/** A gig whose draft was approved and sent with `ticks` on the review: both `sent`. */
export function fixtureSentGig(
  ws: string,
  specialist: GigSpecialist,
  opts: FixtureGigOptions & { deliverable?: GigDeliverable; ticks?: Record<string, boolean> } = {}
): { gig: Gig; attempt: GigAttempt } {
  const { gig, attempt } = fixtureDraftedGig(ws, specialist, opts);
  const review = fixtureReview(opts.ticks ?? { disclosure: true });
  must(transitionGigAttempt(ws, attempt.id, { from: "drafted", to: "approved", patch: { review } }), "approve");
  must(transitionGig(ws, gig.id, { from: "drafted", to: "in_review" }), "in_review");
  const sent = must(
    transitionGigAttempt(ws, attempt.id, { from: "approved", to: "sent", patch: { sentAt: new Date().toISOString() } }),
    "send"
  );
  const g = must(transitionGig(ws, gig.id, { from: "in_review", to: "sent" }), "gig sent");
  return { gig: g.gig, attempt: sent.attempt };
}
