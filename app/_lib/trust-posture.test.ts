import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLASSIFICATION,
  DISCLAIMER,
  OBLIGATIONS,
  SUBPROCESSORS,
  byWeakestFirst,
  postureSummary,
} from "./trust-posture.ts";

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

test("every subprocessor is optional — the self-host path must stay real", () => {
  // kp advertises an air-gapped install. A mandatory external processor would make that
  // claim false, so the invariant is checked rather than trusted.
  for (const s of SUBPROCESSORS) {
    assert.equal(s.optional, true, `${s.name} is listed as mandatory`);
    assert.ok(s.purpose.length > 10, `${s.name} has no stated purpose`);
  }
});

test("the disclaimer refuses to claim certified conformance", () => {
  assert.match(DISCLAIMER, /not a claim of certified conformance/);
  assert.match(DISCLAIMER, /not legal advice/);
});
