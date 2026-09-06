import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUTOMATION_ALERT_KINDS,
  COMM_SENT_KINDS,
  DECISION_META,
  RETIRED_EVENT_KINDS,
  decisionAttribution,
  resolveDecisionKindFilter,
  summarizeAutomationImpact,
  parseCohortProvenance,
  parseSealTraceability,
  matchCohortProvenance,
  sealedReasonOf,
  parseRematchCounterpartId,
  waveReasonText,
  parseEventActor,
  HUMAN_ROLE_TOKENS,
  GROUP_EVAL_JOIN_WINDOW_MS,
} from "./decision-attribution.ts";
import { EVENT_KINDS } from "@/app/features/hiring/pipeline/pipelineEventCatalog";

test("attribution is three-state and never defaults an unknown kind to auto", () => {
  assert.equal(decisionAttribution("auto_rejected"), "auto");
  assert.equal(decisionAttribution("rejected"), "human");
  assert.equal(decisionAttribution("some_future_kind"), "unknown");
  // UAT LUC-ANA-6 / guardrail G6 — mapping the previously-unknown kinds must not have
  // credited any of them to the machine by default. The human-oversight hand-off is the
  // row an Art. 22 reviewer looks for, and it is a person's act, not a policy pass.
  assert.equal(decisionAttribution("human_round_queued"), "human");
  assert.equal(decisionAttribution("stage_migrated"), "human");
  assert.equal(decisionAttribution("offer_reminder_sent"), "auto");
});

test("every comm-sent kind is a mapped kind (a delivery always has an attribution)", () => {
  for (const kind of COMM_SENT_KINDS) {
    assert.notEqual(decisionAttribution(kind), "unknown", `${kind} must be in DECISION_META`);
  }
});

// ---- the writer-coverage guard, DERIVED (UAT LUC-ANA-6) ---------------------------
//
// What was here before: a literal array of ~40 kinds, commented "as of W9-3". It was
// hand-copied, so it aged into a snapshot the moment a writer shipped — and it PASSED
// while four live kinds in the seeded workspace (offer_reminder_sent,
// human_round_queued and two onboarding orphans) badged NEZNÁMÉ, sat in neither filter
// and counted in no rollup. A drift guard whose input is typed out by the person adding
// the drift cannot catch it. The same file already did this right for
// AUTOMATION_ALERT_KINDS; the two guards below extend that to everything.
//
// (1) scans the WRITERS for their event-kind literals; (2) pins DECISION_META set-equal
// to the feed's EVENT_KINDS, from this side (the catalog's own test pins the converse).

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, "..");

/** Every .ts/.tsx file under app/, excluding test files (whose literals are fixtures). */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Kind literals at the two pipeline-event writers:
 *    recordAutomationEvent(<entry>, "<kind>", …)   and   recordEvent(db, { … kind: "<kind>" … }).
 *  Kinds passed as a variable/constant are invisible here — this guard is deliberately
 *  ONE-DIRECTIONAL (a literal writer implies a mapping), never "these are all of them". */
function writtenKindLiterals(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of sourceFiles(APP_ROOT)) {
    const src = readFileSync(file, "utf8");
    for (const re of [
      /recordAutomationEvent\(\s*[^,()]+,\s*"([a-z0-9_]+)"/g,
      // No `s` flag: `.` is never used here and `[^}]` already spans newlines, so
      // dotAll would only cost an es2018 target this tsconfig doesn't set (TS1501).
      /recordEvent\(\s*db\s*,\s*\{[^}]*?kind:\s*"([a-z0-9_]+)"/g,
    ]) {
      for (const m of src.matchAll(re)) if (!found.has(m[1])) found.set(m[1], file);
    }
  }
  return found;
}

test("every event kind a writer names in source is mapped (derived from the writers)", () => {
  const written = writtenKindLiterals();
  // Non-vacuity: if the scan ever stops matching (a refactor renames the writer, a
  // formatting change breaks the regex) it must FAIL rather than pass over an empty set.
  assert.ok(written.size >= 40, `the writer scan found only ${written.size} kinds — it has stopped matching`);
  // Both regexes must still bite: a recordAutomationEvent literal and a recordEvent one.
  // (`auto_rejected` is deliberately NOT the probe — actOnPipelineEntry passes its kind
  // as a variable, which is exactly the blind spot this guard does not claim to cover.)
  assert.ok(written.has("outreach_sent"), "sanity: recordAutomationEvent literals are seen");
  assert.ok(written.has("stage_migrated"), "sanity: recordEvent literals are seen");
  const unmapped = [...written].filter(([kind]) => !DECISION_META[kind]);
  assert.deepEqual(
    unmapped.map(([kind, file]) => `${kind} (${file.slice(APP_ROOT.length + 1)})`),
    [],
    "written but unmapped — add it to DECISION_META (an unmapped kind badges UNKNOWN, is in neither filter, and counts in no rollup)"
  );
});

test("DECISION_META and the feed's EVENT_KINDS are set-equal", () => {
  // The kinds a recruiter can see in the activity feed and the kinds an auditor can
  // attribute/filter/roll up in the decision log are the SAME rows in pipeline_events.
  // Pinning both directions is what makes either map a guard rather than a list: adding
  // a kind to one now fails the other's test.
  const meta = Object.keys(DECISION_META).sort();
  // Widened to string[]: both sides are compared as plain names, and keeping the
  // literal union here makes `feed.includes(k)` reject a `string` from `meta`.
  const feed: string[] = [...EVENT_KINDS].sort();
  assert.deepEqual(
    meta.filter((k) => !feed.includes(k)),
    [],
    "mapped for attribution but absent from EVENT_KINDS — it would render a raw token in the feed"
  );
  assert.deepEqual(
    feed.filter((k) => !meta.includes(k)),
    [],
    "reaches the feed but has no attribution — it would badge UNKNOWN in the decision log"
  );
});

test("policy-pass alert kinds stay mapped (their own derived source)", () => {
  // AUTOMATION_ALERT_KINDS is consumed by the writer itself, so it is the one list that
  // cannot drift from the alert loop. Kept as its own assertion, independent of the scan.
  for (const kind of AUTOMATION_ALERT_KINDS) {
    assert.ok(DECISION_META[kind], `${kind} is written but unmapped — add it to DECISION_META`);
  }
});

test("retired kinds keep their mapping, and stay retired", () => {
  // The post-hire onboarding module was removed and its rows stayed in deployed
  // databases. Dropping the mappings is what made them badge NEZNÁMÉ, so they are kept
  // deliberately — and pinned as HAVING NO WRITER, so a kind cannot quietly come back to
  // life inheriting an attribution nobody re-argued.
  const written = writtenKindLiterals();
  for (const kind of RETIRED_EVENT_KINDS) {
    assert.ok(DECISION_META[kind], `${kind} is retired but unmapped — historical rows would badge UNKNOWN`);
    assert.ok(
      !written.has(kind),
      `${kind} is listed as retired but a writer names it again (${written.get(kind)}) — take it off RETIRED_EVENT_KINDS and re-argue its attribution`
    );
  }
});

test("every policy-pass alert kind attributes to automation (never UNKNOWN)", () => {
  // aging_alert / stale_alert (evaluate_entry) + fairness_gate_blocked_reject (the
  // fairness backstop) are automation-authored — they must fold into the auto count,
  // not render an UNKNOWN badge and vanish from the rollup.
  for (const kind of AUTOMATION_ALERT_KINDS) {
    assert.equal(decisionAttribution(kind), "auto", `${kind} must attribute to automation`);
  }
});

// ---- the two decision-log filters INTERSECT (UAT LUC-ANA-12) ----------------------

test("kind + attribution intersect instead of one silently winning", () => {
  // `advanced` is a recruiter's click (human). Combined with Kdo = human it narrows to
  // that kind; combined with Kdo = automation nothing can match — and the caller must be
  // told so explicitly, because an empty kind list reads as "unfiltered" downstream.
  assert.deepEqual(resolveDecisionKindFilter("advanced", "human"), { kinds: ["advanced"], matchesNothing: false });
  assert.deepEqual(resolveDecisionKindFilter("advanced", "auto"), { matchesNothing: true });
  assert.deepEqual(resolveDecisionKindFilter("auto_advanced", "auto"), { kinds: ["auto_advanced"], matchesNothing: false });
  assert.deepEqual(resolveDecisionKindFilter("auto_advanced", "human"), { matchesNothing: true });
});

test("a contradictory pair NEVER degrades to the unfiltered whole trail", () => {
  // The regression this pins is specifically "narrowed to nothing" collapsing into
  // "showing everything", which on an audit table is the worst possible failure mode.
  const r = resolveDecisionKindFilter("rejected", "auto");
  assert.equal(r.matchesNothing, true);
  assert.equal(r.kinds, undefined, "no kind list at all — an empty one would read as unfiltered");
});

test("each filter alone still works, and junk on either axis is ignored, not fatal", () => {
  assert.deepEqual(resolveDecisionKindFilter("auto_rejected", null), { kinds: ["auto_rejected"], matchesNothing: false });
  assert.deepEqual(resolveDecisionKindFilter(null, null), { matchesNothing: false });
  // An unmapped kind is not a filter — but it must not swallow a valid attribution.
  assert.deepEqual(resolveDecisionKindFilter("not_a_kind", null), { matchesNothing: false });
  const junkKind = resolveDecisionKindFilter("not_a_kind", "human");
  assert.equal(junkKind.matchesNothing, false);
  assert.ok(junkKind.kinds?.includes("rejected"), "the attribution filter survives an unrecognized kind");
  assert.ok(!junkKind.kinds?.includes("auto_rejected"));
});

test("the attribution bucket is derived from the map and stays under the store's IN cap", () => {
  // EVENT_KIND_FILTER_MAX (db/pipeline.ts) truncates the IN list at 64 — silently. A
  // bucket that outgrew it would drop kinds from the filter without saying so, which is
  // the same class of lie this item exists to remove.
  for (const attribution of ["auto", "human"] as const) {
    const kinds = resolveDecisionKindFilter(null, attribution).kinds ?? [];
    assert.ok(kinds.length > 0);
    assert.ok(kinds.length <= 64, `${attribution} bucket is ${kinds.length} kinds — past the store's IN cap`);
    for (const k of kinds) assert.equal(decisionAttribution(k), attribution);
  }
  // Together they account for every mapped kind: no kind is unreachable from Kdo.
  const auto = resolveDecisionKindFilter(null, "auto").kinds ?? [];
  const human = resolveDecisionKindFilter(null, "human").kinds ?? [];
  assert.equal(auto.length + human.length, Object.keys(DECISION_META).length);
});

test("summarize folds counts through attribution and skips unknown kinds", () => {
  const impact = summarizeAutomationImpact(
    {
      advanced: 5,
      auto_advanced: 7,
      auto_rejected: 3,
      outreach_sent: 4,
      comm_resent: 1,
      rejected: 2,
      some_future_kind: 99,
    },
    { raised: 6, resolved: 4 }
  );
  // The actor split: a recruiter's gate click (`advanced`) is HUMAN; only the
  // policy/automation writers' `auto_advanced` credits the machine.
  // auto: auto_advanced 7 + auto_rejected 3 + outreach_sent 4 = 14;
  // human: advanced 5 + rejected 2 + comm_resent 1 = 8.
  assert.equal(impact.autoCount, 14);
  assert.equal(impact.humanCount, 8);
  assert.equal(impact.autoAdvanced, 7);
  assert.equal(impact.autoRejected, 3);
  assert.equal(impact.commsDelivered, 5); // outreach 4 + resend 1
  assert.equal(impact.holdsRaised, 6);
  assert.equal(impact.holdsResolved, 4);
});

test("summarize on an empty window is all zeros", () => {
  const impact = summarizeAutomationImpact({}, { raised: 0, resolved: 0 });
  assert.deepEqual(impact, {
    autoCount: 0,
    humanCount: 0,
    autoAdvanced: 0,
    autoRejected: 0,
    holdsRaised: 0,
    holdsResolved: 0,
    commsDelivered: 0,
  });
});

// ---- log-tells-the-whole-story: the sealed-record joins --------------------------

const groupEvalPayload = (o: Record<string, unknown>) => JSON.stringify({ inputs: o });

test("parseCohortProvenance reads selection/top provenance and rejects bad shapes", () => {
  assert.deepEqual(
    parseCohortProvenance(groupEvalPayload({ cohortSource: "selection", candidates: 4, cohortSize: 12 })),
    { source: "selection", compared: 4, field: 12 }
  );
  assert.deepEqual(
    parseCohortProvenance(groupEvalPayload({ cohortSource: "top", candidates: 8, cohortSize: 8 })),
    { source: "top", compared: 8, field: 8 }
  );
  // Missing / invalid provenance → null (never a fabricated cohort).
  assert.equal(parseCohortProvenance(groupEvalPayload({ candidates: 4, cohortSize: 12 })), null);
  assert.equal(parseCohortProvenance(groupEvalPayload({ cohortSource: "bogus", candidates: 4, cohortSize: 12 })), null);
  assert.equal(parseCohortProvenance(groupEvalPayload({ cohortSource: "top", candidates: 0, cohortSize: 12 })), null);
  assert.equal(parseCohortProvenance("not json"), null);
});

// W0.3 — Art. 12 traceability: a sealed group-eval record must be reconstructible, i.e.
// carry the prompt version that produced the reasoning and the model's own words about
// the lead it crowned. Before this, both were computed and discarded.
test("parseSealTraceability reads the prompt version and the lead's raw model reasoning", () => {
  const t = parseSealTraceability(
    groupEvalPayload({
      cohortSource: "top",
      candidates: 4,
      cohortSize: 9,
      promptVersion: ["match-reasoning-v2"],
      leadReasoning: { verdict: "Strongest on payments depth", strengths: ["ran a migration"], gaps: ["no K8s"] },
    })
  );
  assert.deepEqual(t, {
    promptVersion: ["match-reasoning-v2"],
    leadReasoning: { verdict: "Strongest on payments depth", strengths: ["ran a migration"], gaps: ["no K8s"] },
  });
});

test("parseSealTraceability keeps a MIXED prompt-version set rather than collapsing it", () => {
  // A cache straddling a prompt bump legitimately produces two; reporting one would
  // claim a single prompt ranked the cohort when two did.
  const t = parseSealTraceability(groupEvalPayload({ promptVersion: ["match-reasoning-v1", "match-reasoning-v2"] }));
  assert.deepEqual(t?.promptVersion, ["match-reasoning-v1", "match-reasoning-v2"]);
  assert.equal(t?.leadReasoning, null);
});

test("parseSealTraceability reports ABSENCE rather than an empty shell", () => {
  // Pre-W0.3 seals, and deterministic runs where no model spoke: "not recorded" must be
  // distinguishable from "recorded, and the model said nothing".
  assert.equal(parseSealTraceability(groupEvalPayload({ cohortSource: "top", candidates: 4, cohortSize: 9 })), null);
  assert.equal(parseSealTraceability(groupEvalPayload({ promptVersion: [], leadReasoning: { verdict: "", strengths: [], gaps: [] } })), null);
  assert.equal(parseSealTraceability("not json"), null);
});

test("parseSealTraceability ignores non-string junk inside the reasoning arrays", () => {
  const t = parseSealTraceability(
    groupEvalPayload({ promptVersion: ["v2", 7, null], leadReasoning: { verdict: 5, strengths: ["ok", {}], gaps: null } })
  );
  assert.deepEqual(t?.promptVersion, ["v2"]);
  assert.deepEqual(t?.leadReasoning, { verdict: "", strengths: ["ok"], gaps: [] });
});

test("matchCohortProvenance picks the nearest group-eval record within the window", () => {
  const t0 = "2026-07-15T12:00:00.000Z";
  const near = { kind: "group_eval_lead", reasonCode: "lead", createdAt: "2026-07-15T12:05:00.000Z", payloadJson: groupEvalPayload({ cohortSource: "selection", candidates: 4, cohortSize: 12 }) };
  const far = { kind: "group_eval_advisory", reasonCode: "advisory", createdAt: "2026-07-15T11:30:00.000Z", payloadJson: groupEvalPayload({ cohortSource: "top", candidates: 6, cohortSize: 20 }) };
  // Nearest (5 min) wins over the 30-min-away record.
  assert.deepEqual(matchCohortProvenance(t0, [far, near]), { source: "selection", compared: 4, field: 12 });
  // A non-eval record for the same candidate is ignored.
  const noise = { kind: "auto_rejected", reasonCode: "reject", createdAt: t0, payloadJson: groupEvalPayload({ cohortSource: "selection", candidates: 4, cohortSize: 12 }) };
  assert.equal(matchCohortProvenance(t0, [noise]), null);
  // Outside the window → no match (never guess a stale eval).
  const stale = { ...near, createdAt: new Date(Date.parse(t0) + GROUP_EVAL_JOIN_WINDOW_MS + 1000).toISOString() };
  assert.equal(matchCohortProvenance(t0, [stale]), null);
});

test("sealedReasonOf returns the latest reason of a kind with its params", () => {
  const records = [
    { kind: "auto_rejected", reasonCode: "reject", createdAt: "t2", payloadJson: groupEvalPayload({ pct: 20, n: 10, count: 2, rank: 9, score: 41, threshold: 55, tieAdjusted: 0 }) },
    { kind: "scored", reasonCode: "", createdAt: "t1", payloadJson: "{}" },
  ];
  assert.deepEqual(sealedReasonOf(records, "auto_rejected"), {
    reasonCode: "reject",
    reasonParams: { pct: 20, n: 10, count: 2, rank: 9, score: 41, threshold: 55, tieAdjusted: 0 },
  });
  assert.equal(sealedReasonOf(records, "group_eval_lead"), null);
});

test("parseRematchCounterpartId parses both writers' detail formats", () => {
  // rematched (source side): "<srcJob> -> <tgtJob> (<targetEntryId>)"
  assert.equal(parseRematchCounterpartId("rematched", "job_a -> job_b (entry_tgt)"), "entry_tgt");
  // rematched_from (target side): "<priorEntryId> (<priorJobId>)"
  assert.equal(parseRematchCounterpartId("rematched_from", "entry_prior (job_a)"), "entry_prior");
  // Unparseable / wrong kind → null (honest plain text downstream).
  assert.equal(parseRematchCounterpartId("rematched", "malformed"), null);
  assert.equal(parseRematchCounterpartId("advanced", "entry_x (job_a)"), null);
});

test("waveReasonText localizes through a decisions.wave translator, null for unmapped", () => {
  // A fake next-intl translator scoped to decisions.wave.
  const catalog: Record<string, string> = {
    "reasons.rejectDid": "Auto-rejected · bottom {pct}% of {n}.",
    "reasons.tieAdjustedNote": "(tie-adjusted from {from})",
    "reasons.aboveCutoff": "above the bottom cutoff",
  };
  const t = ((key: string, params?: Record<string, string | number>) =>
    (catalog[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(params?.[k] ?? ""))) as never;
  (t as unknown as { has: (k: string) => boolean }).has = (k: string) => k in catalog;

  assert.equal(
    waveReasonText(t, { reasonCode: "reject", reasonParams: { pct: 20, n: 10, tieAdjusted: 8 } }),
    "Auto-rejected · bottom 20% of 10. (tie-adjusted from 8)"
  );
  assert.equal(waveReasonText(t, { reasonCode: "aboveCutoff", reasonParams: {} }), "above the bottom cutoff");
  assert.equal(waveReasonText(t, { reasonCode: "unmapped_code", reasonParams: {} }), null);
});

// UAT CS-L1-004 (rec 2) — the approver was sealed into payloadJson and rendered nowhere,
// so the compliance reviewer read raw JSON to find who signed off a rejection.
test("waveReasonText names the approver on an adverse decision, and says so when it can't", () => {
  const catalog: Record<string, string> = {
    "reasons.rejectDid": "Auto-rejected · bottom {pct}% of {n}.",
    "reasons.tieAdjustedNote": "(tie-adjusted from {from})",
    "reasons.approvedByNote": "Approved by {who}.",
    "reasons.approverUnidentified": "Approver not identified.",
    "reasons.holdout": "kept as a calibration holdout",
  };
  const t = ((key: string, params?: Record<string, string | number>) =>
    (catalog[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(params?.[k] ?? ""))) as never;
  (t as unknown as { has: (k: string) => boolean }).has = (k: string) => k in catalog;

  // The name the session carried, straight from the sealed record's inputs.
  assert.equal(
    waveReasonText(t, { reasonCode: "reject", reasonParams: { pct: 20, n: 10, approvedBy: "Petra Nováková" } }),
    "Auto-rejected · bottom 20% of 10. Approved by Petra Nováková."
  );
  // Guardrail G3 — a record with no approver must SAY it has none. Silence and "approved
  // by nobody in particular" read identically to an auditor, and a defaulted name would
  // be the overclaim this item exists to remove.
  assert.equal(
    waveReasonText(t, { reasonCode: "reject", reasonParams: { pct: 20, n: 10 } }),
    "Auto-rejected · bottom 20% of 10. Approver not identified."
  );
  // A blank/whitespace approver is an absence, not an identification.
  assert.equal(
    waveReasonText(t, { reasonCode: "reject", reasonParams: { pct: 20, n: 10, approvedBy: "   " } }),
    "Auto-rejected · bottom 20% of 10. Approver not identified."
  );
  // Order: numbers, then the tie note, then the approver.
  assert.equal(
    waveReasonText(t, { reasonCode: "reject", reasonParams: { pct: 20, n: 10, tieAdjusted: 8, approvedBy: "Jan Dvořák" } }),
    "Auto-rejected · bottom 20% of 10. (tie-adjusted from 8) Approved by Jan Dvořák."
  );
  // Only the ADVERSE decision carries the approver line — a keep is not the record a
  // rejected candidate can demand a human reviewer for.
  assert.equal(waveReasonText(t, { reasonCode: "holdout", reasonParams: { approvedBy: "Petra Nováková" } }), "kept as a calibration holdout");
});

// UAT LUC-ANA-4 — pipeline_events had no actor column at all, so the log's "Who" could
// only ever render a CLASS derived from `kind`.
test("parseEventActor separates the machine, the named person, and the unidentified", () => {
  assert.deepEqual(parseEventActor("auto:screen-wave"), { kind: "auto", name: "screen-wave" });
  assert.deepEqual(parseEventActor("auto:sim"), { kind: "auto", name: "sim" });
  // A person, named.
  assert.deepEqual(parseEventActor("human:Petra Nováková"), { kind: "human", name: "Petra Nováková" });
  // A colon inside the name survives (the FIRST separator wins).
  assert.deepEqual(parseEventActor("human:Novák: Jan"), { kind: "human", name: "Novák: Jan" });
  // A ROLE token is a class, not a person: a human acted and we cannot say which one.
  for (const role of HUMAN_ROLE_TOKENS) {
    assert.deepEqual(parseEventActor(`human:${role}`), { kind: "human", name: null }, `human:${role} must not read as a person`);
  }
  assert.deepEqual(parseEventActor("HUMAN:Recruiter"), { kind: "human", name: null }, "the vocabulary is case-insensitive");
  // Never guess: a legacy row (NULL), a blank, a bare token or an unknown prefix is
  // "unknown" — not "auto", and not the operator.
  for (const missing of [null, undefined, "", "   ", "recruiter", ":x", "human:", "robot:thing"]) {
    assert.deepEqual(parseEventActor(missing), { kind: "unknown", name: null }, `"${String(missing)}" must not be attributed`);
  }
});

// ---- DECISION_META <-> catalog lockstep (wave 41 D1) -------------------------------
//
// The map and the label catalog were only coupled by habit. `offer_comms_failed` was
// mapped in c22d5e05 with no `analytics.log.kinds.*` entry in any of the four catalogs,
// and `kindLabel` degrades an unlabelled kind to the de-snaked raw key — so the row that
// says "the offer approval is still open because the message never went out" rendered as
// "offer comms failed" in Czech, German and French alike. Nothing failed; the degrade
// path is deliberate for a kind nobody mapped, and it silently covered for one that was.
//
// So the mapping is now the input to a catalog assertion, in BOTH directions and in all
// four locales: a kind added to DECISION_META owes four labels in the same change, and a
// label whose kind is gone is dead copy translators keep paying for.
//
// This lives here rather than in `npm run i18n:check`: that gate's satellite registry
// (SATELLITE_ERROR_SOURCES) is shaped for ERROR CODES specifically — a `code:` literal
// scan against `errors.*` — and DECISION_META is neither a code nor spelled that way.
// Teaching the gate a second, differently-shaped registry buys nothing the unit suite
// does not already run on every push.

const REPO_ROOT = resolve(APP_ROOT, "..");
const CATALOG_LOCALES = ["en", "cs", "de", "fr"] as const;

function kindCatalog(locale: string): Record<string, string> {
  const raw = JSON.parse(readFileSync(join(REPO_ROOT, "messages", `${locale}.json`), "utf8")) as {
    analytics: { log: { kinds: Record<string, string> } };
  };
  return raw.analytics.log.kinds;
}

test("every mapped decision kind has a label in all four catalogs", () => {
  const kinds = Object.keys(DECISION_META);
  assert.ok(kinds.length >= 60, `only ${kinds.length} kinds — DECISION_META has stopped being read`);
  for (const locale of CATALOG_LOCALES) {
    const catalog = kindCatalog(locale);
    assert.deepEqual(
      kinds.filter((k) => typeof catalog[k] !== "string" || catalog[k].trim() === ""),
      [],
      `messages/${locale}.json analytics.log.kinds is missing a label — kindLabel would render the de-snaked raw key`
    );
  }
});

test("no catalog label outlives the kind it labels", () => {
  // The converse direction, so a kind RETIRED out of DECISION_META (never merely
  // renamed) takes its four labels with it instead of leaving copy in the translation
  // budget forever. RETIRED_EVENT_KINDS stay MAPPED, so they are covered by the test
  // above, not exempted from this one.
  for (const locale of CATALOG_LOCALES) {
    assert.deepEqual(
      Object.keys(kindCatalog(locale)).filter((k) => !(k in DECISION_META)),
      [],
      `messages/${locale}.json labels a kind that is no longer in DECISION_META`
    );
  }
});
