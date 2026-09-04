import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLASSIFICATION,
  DISCLAIMER,
  LAST_REVIEWED,
  OBLIGATIONS,
  SUBPROCESSORS,
  byWeakestFirst,
  postureSummary,
} from "./trust-posture.ts";
import { INTERVIEW_PLAN_DEFAULT } from "./decision-config-schema.ts";
import { HUMAN_ROLE_ACTOR, isNamedApprover, PLACEHOLDER_APPROVER } from "./auth/operator-approver.ts";
import { parseEventActor } from "./decision-attribution.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const source = (...rel: string[]) => readFileSync(path.join(HERE, ...rel), "utf8");

// This page makes public claims about a regulated system. These tests exist so a future
// edit cannot quietly turn it into a badge — the failure mode being guarded is
// "everything is green", not a rendering bug.

test("every obligation states a checkable summary", () => {
  for (const r of OBLIGATIONS) {
    assert.ok(r.article.startsWith("Art."), `${r.title}: article must be cited, not paraphrased`);
    assert.ok(r.summary.length > 40, `${r.article}: summary too thin to be checked`);
  }
});

test("a non-enforced obligation must NAME its gap", () => {
  // The whole value of the page: partial and missing rows say what is missing. A row that
  // claims less than full enforcement without saying why is worse than no row.
  for (const r of OBLIGATIONS) {
    if (r.posture !== "enforced") {
      assert.ok(r.gap && r.gap.length > 20, `${r.article} is ${r.posture} but names no gap`);
    }
  }
});

test("the page is not all-green — it publishes real gaps", () => {
  const s = postureSummary();
  assert.ok(s.partial + s.not_yet >= 3, "a trust page with nothing outstanding is a badge, not evidence");
  assert.ok(s.enforced >= 1, "and it should still show what IS enforced");
});

test("weakest-first ordering leads with what is missing", () => {
  const ordered = byWeakestFirst();
  assert.equal(ordered[0].posture, "not_yet");
  assert.equal(ordered.at(-1)!.posture, "enforced");
  assert.equal(ordered.length, OBLIGATIONS.length);
});

test("classification does not hedge on high-risk or on the derogation", () => {
  assert.match(CLASSIFICATION.conclusion, /high-risk/);
  assert.match(CLASSIFICATION.annex, /Annex III/);
  // Art. 6(3) is the standard escape hatch; explicitly disclaiming it is the point.
  assert.match(CLASSIFICATION.derogation, /does not apply/);
  assert.match(CLASSIFICATION.providerRole, /deployer/);
});

test("the two articles kp leads on are the two it claims as enforced", () => {
  // Record-keeping and human oversight are the competitive claims (auditable decisions,
  // a human signs every call). If either ever drops below enforced, the marketing must
  // change with it — this test is the tripwire.
  const byArticle = Object.fromEntries(OBLIGATIONS.map((r) => [r.article, r.posture]));
  assert.equal(byArticle["Art. 12"], "enforced");
  assert.equal(byArticle["Art. 14"], "enforced");
});

test("the Art. 14 kill-switch clause matches the control that actually exists", () => {
  // Pinned like the subprocessor invariant below, and for the same reason: this is the
  // sentence a procurement/DPO reviewer reads as an Art. 14(4)(e) stop control, so it
  // must not drift back into describing a control the code does not implement.
  //
  // Two facts it is pinned against:
  //  1. The pause is SINGLE-CLICK by design — app/control/AutonomyBar.tsx says so in a
  //     comment ("an oversight surface must be able to halt automation instantly"); the
  //     arm/confirm guard is on Reconcile, which mutates lifecycle state. The old claim
  //     "a kill switch arms and confirms separately" described the opposite control.
  //  2. It is SCOPED, and the scope has MOVED. getAutonomy() once had a single
  //     behavioural consumer (the case-lifecycle orchestrator) while every timed pass
  //     in instrumentation-node.ts ignored it. That is closed: the clock now gates the
  //     policy pass, interview/offer reminders, offer lapse and the pull/edge drain on
  //     it. ONE pass stays exempt on purpose — the consent-expiry anonymisation sweep,
  //     a statutory retention duty an operator toggle must not be able to suspend. So
  //     the gap must still exist and must still name the exemption; the assertion below
  //     is deliberately loose about the wording and strict about it being SAID.
  const art14 = OBLIGATIONS.find((r) => r.article === "Art. 14");
  assert.ok(art14, "Art. 14 row is missing");
  assert.doesNotMatch(
    art14.summary,
    /arms and confirms/i,
    "the pause fires on a single click by design; only Reconcile arms and confirms",
  );
  assert.match(art14.summary, /single click/i, "the single-click property must be stated, not implied");
  assert.ok(
    art14.gap && /paus/i.test(art14.gap),
    "an enforced row whose stop control is scoped must still name that scope as a gap",
  );
  // The exemption is the whole of the remaining scope limit, so it is the one thing a
  // reviewer must not have to infer. Pinned by SUBJECT (consent/anonymis*), not by
  // phrasing, so the sentence can be reworded without going red — but cannot be
  // silently dropped, and cannot drift back to claiming the pause reaches everything.
  assert.match(
    art14.gap!,
    /consent|anonymis/i,
    "the one exempt pass must be named — a reviewer cannot be left to infer what the stop control does not reach",
  );
  assert.doesNotMatch(
    art14.gap!,
    /are not yet wired to it/i,
    "the pre-closure scope claim must not survive: the timed passes ARE wired to the pause now",
  );
});

/* ── Art. 14 parity with the landing page ────────────────────────────────────
 *
 * Both surfaces describe the SAME gate, and on 2026-08-28 they described it
 * differently for one commit: the landing retired the absolute ("No candidate is
 * advanced, offered or rejected by the machine alone… not a setting") because
 * two thirds of it were false, and this row kept it. Two pages making one claim
 * is one claim; the honest half must be the same half on both.
 *
 * These are deliberately the SAME pins `app/landing/spark/MarketingClaims.test.ts`
 * carries — the shipped default plan, and the auto branches that exist to be
 * delegated to — read here off the same modules. If the product's real shape
 * moves, both suites go red together instead of one page quietly outliving it. */

test("the Art. 14 row does not re-assert the absolute the landing retired", () => {
  const art14 = OBLIGATIONS.find((r) => r.article === "Art. 14")!;
  assert.doesNotMatch(
    art14.summary,
    /by the machine alone/i,
    "screeningGate:'auto' and offerGate:'auto' exist; a page claiming nothing advances or is offered by the machine alone is false"
  );
  assert.doesNotMatch(
    art14.summary,
    /not a setting/i,
    "the gates ARE a setting — Settings → Hiring configures them"
  );
  // The honest half, which the landing keeps and which nothing configurable can
  // take away. Pinned by SUBJECT so the sentence can be reworded.
  assert.match(art14.summary, /rejection is always a person|no gate can delegate/i, "the rejection absolute is the claim worth making, and it must be made");
  // And the qualifier that makes the other two honest, exactly as the landing's
  // four catalogs have to carry "by default" (MarketingClaims.test.ts).
  assert.match(
    art14.summary,
    /\bby default\b/i,
    "advance/offer are only human-gated BY DEFAULT; the row must say so, as the landing does"
  );
});

test("the shipped hiring plan is what makes the 'by default' half true", () => {
  // Identical to MarketingClaims.test.ts's plan pin, on purpose: the sentence on
  // /trust rests on the same object, so it must fail on the same change.
  const steps = INTERVIEW_PLAN_DEFAULT.steps;
  assert.ok(steps.length > 0, "the default plan governs at least one column");
  for (const step of steps) {
    assert.equal(step.gate, "human", `/trust claims every gate is human BY DEFAULT; the shipped default sets ${step.stageId} to "${step.gate}"`);
    for (const round of step.rounds) {
      assert.equal(round.gate, "human", `the shipped default leaves a ${round.kind} round at ${step.stageId} unattended`);
    }
  }
});

test("the two gates the Art. 14 row calls delegable are the two that exist", () => {
  const automation = source("automation-run.ts");
  for (const role of ["screening", "offer"]) {
    assert.match(
      automation,
      new RegExp(`getPlanGateForRole\\("${role}"[^)]*\\)\\s*===\\s*"auto"`),
      `automation-run.ts no longer delegates ${role}; the Art. 14 row's "by default" hedge may be too weak now`
    );
  }
  // The absolute that survives. A rejection gate would falsify the first sentence
  // of the row AND of landing.trust.human.body in four catalogs.
  assert.doesNotMatch(
    automation,
    /getPlanGateForRole\("(rejection|reject)"/,
    "a rejection gate would falsify the one Art. 14 absolute /trust still asserts"
  );
});

/* ── Art. 12: the record has to name somebody ────────────────────────────────
 *
 * G5. The chain sealed 66 records naming "operator (single-operator deployment)"
 * while this row claimed each carries "a named human". The wave now refuses to
 * commit rather than seal an approval nobody owns, and the audit table marks the
 * records that predate the refusal. Both halves are pinned, because the row now
 * says both. */

test("a bulk rejection cannot be sealed to the placeholder approver", () => {
  assert.equal(isNamedApprover(PLACEHOLDER_APPROVER), false, "the posture string is not a person");
  assert.equal(isNamedApprover(""), false);
  assert.equal(isNamedApprover(null), false);
  assert.equal(isNamedApprover("Petra Nováková"), true);

  const wave = source("screen-wave.ts");
  assert.match(
    wave,
    /!dryRun && !isNamedApprover\(approvedBy\)/,
    "the seal path must refuse an unnamed approver on COMMIT — in the lib, so a second caller inherits the refusal"
  );
  // A preview writes nothing, so it must stay reachable: an operator who cannot
  // yet be named still needs to see what the wave would do, and why it will not run.
  assert.match(wave, /if \(!dryRun && !isNamedApprover/, "the refusal must be scoped to a commit, never to a dry run");
  assert.match(OBLIGATIONS.find((r) => r.article === "Art. 12")!.summary, /name the person|cannot name/i);
});

test("the audit surface can tell a named approver from a role", () => {
  // The chain is history and is never rewritten, so the row that predates the
  // refusal has to be READ correctly rather than edited. This is the exact
  // discrimination the table's badge renders.
  assert.deepEqual(parseEventActor(HUMAN_ROLE_ACTOR), { kind: "human", name: null }, "the role token must not read as a person");
  assert.deepEqual(parseEventActor("human:Petra Nováková"), { kind: "human", name: "Petra Nováková" });
  const table = source("..", "features", "insights", "analytics", "sections", "DecisionRecordsTable.tsx");
  assert.match(table, /parseEventActor\(r\.actor\)/, "the actor column must classify the token, not print it raw");
  assert.match(table, /actorRoleOnly/, "and mark the records whose actor is a role");
});

test("every subprocessor is optional — the self-host path must stay real", () => {
  // kp advertises an air-gapped install. A mandatory external processor would make that
  // claim false, so the invariant is checked rather than trusted.
  for (const s of SUBPROCESSORS) {
    assert.equal(s.optional, true, `${s.name} is listed as mandatory`);
    assert.ok(s.purpose.length > 10, `${s.name} has no stated purpose`);
  }
});

test("every LLM provider the product can route to is disclosed as a subprocessor", () => {
  // The subprocessor table is the page's most checkable claim: a reviewer can hold it
  // against the product's own provider list. That list is LLM_PROVIDERS in
  // llm-config.ts, and it had grown a `qwen` adapter the table never named — a
  // remote endpoint a customer can route candidate data to, absent from the
  // disclosure. Read from the source text rather than importing llm-config, which
  // pulls the DB slice; the coupling is what matters, not the module graph.
  const config = source("llm-config.ts");
  const declared = config.match(/export const LLM_PROVIDERS = \[([^\]]*)\]/);
  assert.ok(declared, "LLM_PROVIDERS is no longer a literal array in llm-config.ts — this test has gone blind");
  const providers = [...declared[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(providers.length >= 5, `parsed only ${providers.length} providers — the regex has drifted`);

  const covered = new Set(SUBPROCESSORS.flatMap((s) => s.providers));
  for (const p of providers) {
    assert.ok(covered.has(p), `LLM provider "${p}" can be routed to but no subprocessor row discloses it`);
  }
  // And the reverse: a row that claims a provider the product cannot route to is a
  // disclosure of something that does not exist.
  for (const p of covered) {
    assert.ok(providers.includes(p), `subprocessor row claims provider "${p}", which is not in LLM_PROVIDERS`);
  }
});

test("the trust page states when it was last reviewed", () => {
  // A compliance posture with no date is a claim about an unknown moment. The legal
  // pages carry `Last updated`; this one carried nothing but the AI Act's own
  // application date, which is not the same fact.
  assert.match(LAST_REVIEWED, /^\d{4}-\d{2}-\d{2}$/, "the review date must be an ISO day, rendered from a constant");
  assert.ok(Number.isFinite(Date.parse(LAST_REVIEWED)), "the review date must parse");
});

test("the disclaimer refuses to claim certified conformance", () => {
  assert.match(DISCLAIMER, /not a claim of certified conformance/);
  assert.match(DISCLAIMER, /not legal advice/);
});
