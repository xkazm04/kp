import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLASSIFICATION,
  DATA_RIGHTS,
  DISCLAIMER,
  LAST_REVIEWED,
  OBLIGATIONS,
  REGULATION_CHECKED,
  SUBPROCESSORS,
  byWeakestFirst,
  needsAttention,
  postureSummary,
  subprocessorsVerifiedSince,
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

/* ── The applicability date, and the review that did not catch it ────────────
 *
 * This page published "2 August 2026" for six weeks after Regulation (EU)
 * 2026/1744 moved the Annex III obligations to 2 December 2027 — through a code
 * review that bumped LAST_REVIEWED and left the date standing, because reading
 * the claims against the repository is not the same act as reading them against
 * the law. Both halves are pinned below: the date itself, and the second review
 * field whose absence is what let the first one rot. */

test("the applicability date is the deferred one, and names the act that deferred it", () => {
  assert.match(CLASSIFICATION.appliesFrom, /2027/, "the Annex III obligations moved to 2 December 2027");
  assert.doesNotMatch(
    CLASSIFICATION.appliesFrom,
    /2 August 2026/,
    "the superseded date must not come back — it was published, indexed and wrong",
  );
  assert.match(
    CLASSIFICATION.deferredBy,
    /2026\/1744/,
    "naming the amending regulation is the credibility signal: a reader can check it",
  );
});

test("the deferral is never stated without the obligations that were NOT deferred", () => {
  // A page that reports only the later date is true and misleading at once. The
  // prohibitions have bound since February 2025 and the transparency duties since
  // August 2026, and those are the ones that can bite a deployment today.
  assert.match(CLASSIFICATION.inForceNow, /Art\. 5/, "the prohibitions bind now and must be said to");
  assert.match(CLASSIFICATION.inForceNow, /Art\. 50/, "the transparency duties bind now too");
  assert.match(
    CLASSIFICATION.inForceNow,
    /GDPR/,
    "GDPR was never on the AI Act's clock; a reader must not infer a reprieve from it",
  );
});

test("the regulation review date is separate from the code review date", () => {
  for (const [label, value] of [
    ["LAST_REVIEWED", LAST_REVIEWED],
    ["REGULATION_CHECKED", REGULATION_CHECKED],
  ] as const) {
    assert.match(value, /^\d{4}-\d{2}-\d{2}$/, `${label} must be an ISO day`);
    assert.ok(Number.isFinite(Date.parse(value)), `${label} must parse`);
  }
});

test("the classification covers the JD builder, not only the scorer", () => {
  // The builder derives the required qualifications itself and then feeds the scorer
  // that ranks CVs against them, so it is inside the high-risk system rather than a
  // low-risk sibling. It looks like the safe part of the product, which is exactly
  // why its absence from the classification is the omission a reviewer would probe.
  assert.match(
    CLASSIFICATION.derogation,
    /job-description|qualification/i,
    "the JD builder must be named in the classification, not left implicit",
  );
});

/* ── Art. 12: the seal's strength is a deployment property, not a given ──────
 *
 * The row asserted "tamper-evident … HMAC-SHA256, key rotation, anti-downgrade"
 * unconditionally while the reference deploy ships with no key at all — a plain
 * hash chain that decision-record-store.test.ts pins as accepting an insider
 * re-hash. The engineering doc corrected that sentence; the public page did not,
 * on the row a procurement reviewer reads most closely. */

test("the Art. 12 row does not claim an HMAC the default deployment does not have", () => {
  const art12 = OBLIGATIONS.find((r) => r.article === "Art. 12")!;
  const claimsHmac = /HMAC/i.test(art12.summary);
  if (claimsHmac) {
    assert.match(
      art12.summary,
      /where the operator configures|with no key|when a key/i,
      "an HMAC claim must be conditioned on the key being configured — it is not the default",
    );
  }
  assert.ok(art12.gap, "the Art. 12 row must keep naming its limits");
  assert.match(
    art12.gap!,
    /unkeyed|no key|not tamper-resistant/i,
    "the keyless default is the case most deployments are in; it cannot be left to inference",
  );
  assert.match(
    art12.gap!,
    /truncat/i,
    "truncation of the newest records is undetectable at any key setting, and the page must say so",
  );
});

/* ── Art. 5 and Art. 50: the two articles in force TODAY ─────────────────────
 *
 * The table used to start at Art. 9 — it opened at obligations 15 months away
 * and never mentioned either article that was already enforceable. One of them
 * (Art. 5) is the one kp most cleanly satisfies, and a breach of it cannot be
 * cured by any safeguard, so claiming it is free and losing it is fatal. */

test("the two articles already in force are both on the page", () => {
  const byArticle = Object.fromEntries(OBLIGATIONS.map((r) => [r.article, r]));
  assert.ok(byArticle["Art. 5"], "the prohibitions have bound since February 2025 and must be stated");
  assert.ok(byArticle["Art. 50"], "the transparency duties have bound since August 2026");
});

test("the Art. 5 row rests on the two facts that actually make it true", () => {
  const art5 = OBLIGATIONS.find((r) => r.article === "Art. 5")!;
  assert.equal(art5.posture, "enforced", "kp does not infer emotion; under-claiming this costs as much as over-claiming");
  // Both halves are load-bearing and both are cheap to lose: persisting audio would
  // put a prosodic signal in reach, and dropping the prompt's no-delivery clause
  // would let the model score affect from a transcript.
  assert.match(art5.summary, /transcript/i, "transcript-only storage is half the reason this row is true");
  assert.match(
    art5.summary,
    /never the audio|no audio|not the audio/i,
    "never storing the audio is what keeps a prosodic signal out of scoring entirely",
  );
  assert.match(
    art5.summary,
    /nerves|filler|substance/i,
    "the scorecard prompt's rate-substance-not-delivery instruction is the other half",
  );
});

test("the Art. 50 row admits the marking gap rather than resting on the disclosure", () => {
  const art50 = OBLIGATIONS.find((r) => r.article === "Art. 50")!;
  assert.notEqual(art50.posture, "enforced", "synthetic-content marking is not implemented");
  assert.match(art50.gap!, /mark/i, "the missing half is marking, and it has a 2026 deadline");
});

/* ── The subprocessor table has to answer a reviewer's real questions ────────
 *
 * It rendered as two columns of prose — name and purpose — on the page whose
 * whole thesis is checkable claims. The posture fields below are the checkable
 * part, and the per-row verifiedOn exists because ONE page-level review date is
 * what let the applicability date above go stale unnoticed. */

test("every subprocessor declares a full, dated posture", () => {
  for (const s of SUBPROCESSORS) {
    assert.match(s.verifiedOn, /^\d{4}-\d{2}-\d{2}$/, `${s.name}: verifiedOn must be an ISO day`);
    assert.ok(s.retention.length > 5, `${s.name}: retention must say something a reader can use`);
    if (s.dataClass === "candidate_pii" && s.trainsOnInputs !== "no") {
      // The whole point of the column. A processor that may train on candidate data
      // is the one row a reader must not skim, so it owes an explanation.
      assert.ok(
        s.note && s.note.length > 40,
        `${s.name} may train on candidate data and must explain the circumstances`,
      );
    }
  }
});

test("a processor that only sees billing data is not presented as one that sees candidates", () => {
  // Listing a payment processor and a model provider identically overstates the first
  // and understates the second; both directions mislead.
  const classes = new Set(SUBPROCESSORS.map((s) => s.dataClass));
  assert.ok(classes.has("candidate_pii"), "model providers see candidate data and the table must say so");
  assert.ok(classes.has("operator_only"), "billing is a different data class and must be distinguished");
});

test("the routes that engage nobody are disclosed too", () => {
  // A page that lists a hosted processor without naming its self-hosted substitute is
  // only half honest — and for kp the substitute is the differentiator.
  const selfHosted = SUBPROCESSORS.filter((s) => s.euRegion === "self_hosted");
  assert.ok(selfHosted.length >= 2, "both the local model server and the local voice server must be named");
  for (const s of selfHosted) {
    assert.equal(s.dataClass, "none", `${s.name} keeps data on the operator's own infrastructure`);
  }
});

test("the CLI route is disclosed separately from the metered API", () => {
  // These were ONE row called "Anthropic". They are the same models under materially
  // different terms: an API key carries a processing agreement, a personal
  // subscription does not and may train on what it is sent. One row hid that.
  const cli = SUBPROCESSORS.find((s) => s.providers.includes("claude_cli"));
  const api = SUBPROCESSORS.find((s) => s.providers.includes("anthropic"));
  assert.ok(cli && api, "both Anthropic routes must be disclosed");
  assert.notEqual(cli!.name, api!.name, "collapsing them into one row hides the posture difference");
  assert.match(
    cli!.note!,
    /no data-processing agreement|no processing agreement|carries no data-processing/i,
    "the missing processing agreement is the whole point of splitting the row",
  );
});

test("the table's stated freshness is its stalest row", () => {
  const since = subprocessorsVerifiedSince();
  for (const s of SUBPROCESSORS) {
    assert.ok(s.verifiedOn >= since, `${s.name} is older than the date the page advertises`);
  }
});

test("attention is drawn to the rows that deserve it, and only those", () => {
  for (const s of SUBPROCESSORS) {
    if (s.dataClass !== "candidate_pii") {
      assert.equal(needsAttention(s), false, `${s.name} sees no candidate data and must not be flagged`);
    }
  }
});

/* ── The erasure claim had to be scoped ──────────────────────────────────────
 *
 * "Erasure runs as a single transaction across the profile, transcripts,
 * scorecards and the outbox" is true of what kp stores and false of the copy a
 * hosted voice provider keeps in the operator's own account under its own
 * retention setting. No transaction in this product can reach that. */

test("the erasure claim is scoped to what kp actually holds", () => {
  const erasure = DATA_RIGHTS.find((line) => /erasure runs/i.test(line));
  assert.ok(erasure, "the erasure claim must still be made — it is a real and unusual control");
  assert.match(
    erasure!,
    /third part|cannot reach|voice provider/i,
    "the claim must name the copy it cannot reach, or it is false for every voice interview",
  );
});

test("the training claim distinguishes what kp does from what a provider may do", () => {
  const training = DATA_RIGHTS.find((line) => /train/i.test(line));
  assert.ok(training, "the no-training claim is worth making");
  assert.doesNotMatch(
    training!,
    /never used to train models\.?$/i,
    "an unqualified never is not kp's to make: a free-tier provider key can put candidate data into training",
  );
});

test("the disclaimer refuses to claim certified conformance", () => {
  assert.match(DISCLAIMER, /not a claim of certified conformance/);
  assert.match(DISCLAIMER, /not legal advice/);
});
