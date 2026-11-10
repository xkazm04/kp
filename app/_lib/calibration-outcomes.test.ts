// Pure coverage for calibration-outcomes.ts: interval maths, the honesty floor, the
// person-versus-automation split, provenance (seeded / simulation), an empty
// workspace, the auto-advance band audit, and two drift pins (the Python policy bar,
// the DECISION_META attribution of the kinds this module reads).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  AUTO_ADVANCE_CONFIDENCE,
  OUTCOME_RATE_FLOOR,
  OUTCOME_RANK_FLOOR,
  buildOutcomeLadder,
  computeScoreOutcomes,
  decisionAuthor,
  rankAuc,
  rateCell,
  wilsonInterval,
  type AdvanceConfidence,
  type OutcomeAxis,
  type OutcomeEntry,
  type OutcomeEvent,
} from "./calibration-outcomes.ts";

const AXIS: OutcomeAxis = { stages: ["Accepted", "Screened", "Interview", "Offer", "Hired"], advanceIndex: 2, terminalIndex: 4 };
const here = path.dirname(fileURLToPath(import.meta.url));

let clock = Date.parse("2026-10-01T00:00:00Z");
const at = () => new Date((clock += 60_000)).toISOString();
const ev = (entryId: string, kind: string, fromStage: string | null, toStage: string | null, actor: string | null = null): OutcomeEvent => ({
  entryId,
  kind,
  fromStage,
  toStage,
  actor,
  at: at(),
});
const entry = (entryId: string, match: number, extra: OutcomeEntry["scores"] = {}): OutcomeEntry => ({ entryId, scores: { match, ...extra } });

test("wilsonInterval matches the textbook values and refuses n = 0", () => {
  const ci = wilsonInterval(8, 10)!;
  assert.ok(Math.abs(ci.lo - 0.4902) < 1e-3, `lo ${ci.lo}`);
  assert.ok(Math.abs(ci.hi - 0.9433) < 1e-3, `hi ${ci.hi}`);
  const zero = wilsonInterval(0, 10)!;
  assert.equal(zero.lo, 0);
  assert.ok(zero.hi > 0.25 && zero.hi < 0.32, "0/10 still has a real upper bound");
  assert.equal(wilsonInterval(0, 0), null);
  assert.equal(wilsonInterval(3, 2), null);
});

test("rateCell never carries a rate below the floor", () => {
  const thin = rateCell(7, OUTCOME_RATE_FLOOR - 1);
  assert.equal(thin.state, "thin");
  assert.equal(thin.rate, null);
  assert.equal(thin.lo, null);
  assert.equal(thin.n, OUTCOME_RATE_FLOOR - 1);
  assert.equal(rateCell(0, 0).state, "empty");
  const measured = rateCell(4, OUTCOME_RATE_FLOOR);
  assert.equal(measured.state, "measured");
  assert.equal(measured.rate, 4 / OUTCOME_RATE_FLOOR);
  assert.ok(measured.lo! < measured.rate! && measured.hi! > measured.rate!);
});

test("rankAuc: perfect order, inverted order, all ties, one class missing", () => {
  const ordered = [1, 2, 3].map((s) => ({ score: s, positive: false })).concat([7, 8, 9].map((s) => ({ score: s, positive: true })));
  assert.equal(rankAuc(ordered), 1);
  assert.equal(rankAuc(ordered.map((p) => ({ ...p, positive: !p.positive }))), 0);
  assert.equal(rankAuc([{ score: 5, positive: true }, { score: 5, positive: false }]), 0.5);
  assert.equal(rankAuc([{ score: 5, positive: true }]), null);
});

test("decisionAuthor: actor class wins, kind decides a legacy null actor, comms are not decisions", () => {
  assert.equal(decisionAuthor({ kind: "advanced", actor: null }), "human");
  assert.equal(decisionAuthor({ kind: "auto_advanced", actor: null }), "automation");
  assert.equal(decisionAuthor({ kind: "advanced", actor: "auto:sim" }), "automation");
  assert.equal(decisionAuthor({ kind: "rejected", actor: "human:Petra" }), "human");
  assert.equal(decisionAuthor({ kind: "rejection_sent", actor: null }), "other");
  assert.equal(decisionAuthor({ kind: "scheduled", actor: null }), "other");
});

test("an automated advance is never ground truth: person and automation are counted apart", () => {
  const events = [
    ev("auto", "auto_advanced", "Screened", "Interview"),
    ev("person", "advanced", "Screened", "Interview"),
    ev("rejected", "rejected", "Screened", "Screened"),
  ];
  const ladder = buildOutcomeLadder(events, AXIS);
  assert.equal(ladder.get("auto")!.humanFurthest, -1);
  assert.equal(ladder.get("auto")!.anyFurthest, 2);
  assert.equal(ladder.get("auto")!.automatedAdvances, 1);
  assert.equal(ladder.get("person")!.humanFurthest, 2);
  assert.equal(ladder.get("rejected")!.humanRejected, true);

  const r = computeScoreOutcomes([entry("auto", 90), entry("person", 90), entry("rejected", 90)], events, [], AXIS);
  assert.deepEqual(r.ladder, { decidedByPerson: 2, automationOnly: 1, undecided: 0, humanRejected: 1 });
  const top = r.bands[4];
  const interview = top.cells.find((c) => c.stage === "Interview")!.cell;
  assert.equal(interview.n, 2, "the automation-only candidate is not in the denominator");
  assert.equal(interview.k, 1);
  assert.equal(top.automationOnly, 1);
});

test("a hire after an accepted offer counts as a person's outcome; a reinstate lifts a reject", () => {
  const events = [
    ev("h", "advanced", "Interview", "Offer"),
    ev("h", "offer_accepted", null, null),
    ev("h", "auto_advanced", "Offer", "Hired"),
    ev("r", "rejected", "Screened", "Screened"),
    ev("r", "reinstated", "Screened", "Screened"),
  ];
  const ladder = buildOutcomeLadder(events, AXIS);
  assert.equal(ladder.get("h")!.humanFurthest, 4);
  assert.equal(ladder.get("r")!.humanRejected, false);
});

test("seeded and simulated rows are excluded and named, never read as evidence", () => {
  const events = [
    ev("s1", "matched", null, "Screened"),
    ev("s1", "advanced", null, "Offer"), // the seeder's advance: kind says human, it is not
    ev("sim", "auto_advanced", "Accepted", "Screened", "auto:sim"),
    ev("sim", "advanced", "Screened", "Interview"),
  ];
  const r = computeScoreOutcomes([entry("s1", 85), entry("sim", 85), entry("nolog", 85)], events, [], AXIS);
  assert.deepEqual(r.population, { scored: 3, live: 0, seeded: 1, simulation: 1, untracked: 1 });
  assert.deepEqual(r.ladder, { decidedByPerson: 0, automationOnly: 0, undecided: 0, humanRejected: 0 });
  for (const band of r.bands) for (const c of band.cells) assert.equal(c.cell.state, "empty");
  for (const row of r.rank) assert.equal(row.auc, null);
});

test("an empty workspace answers with zeros of counts and no rates at all", () => {
  const r = computeScoreOutcomes([], [], [], AXIS);
  assert.equal(r.population.scored, 0);
  assert.equal(r.audit.support, null);
  assert.equal(r.audit.above.state, "empty");
  assert.ok(r.rank.every((row) => row.state === "not-recorded" && row.auc === null));
  assert.deepEqual(r.stages, ["Screened", "Interview", "Offer", "Hired"]);
});

test("AUC appears only with the floor met in BOTH classes; potential components say not-recorded", () => {
  const entries: OutcomeEntry[] = [];
  const events: OutcomeEvent[] = [];
  for (let i = 0; i < OUTCOME_RANK_FLOOR; i += 1) {
    entries.push(entry(`p${i}`, 70 + i));
    events.push(ev(`p${i}`, "advanced", "Screened", "Interview"));
    entries.push(entry(`n${i}`, 20 + i));
    events.push(ev(`n${i}`, "rejected", "Screened", "Screened"));
  }
  const r = computeScoreOutcomes(entries, events, [], AXIS);
  const match = r.rank.find((x) => x.key === "match" && x.target === "advance")!;
  assert.equal(match.state, "measured");
  assert.equal(match.auc, 1);
  assert.equal(r.rank.find((x) => x.key === "potentialDepth")!.state, "not-recorded");

  const thin = computeScoreOutcomes(entries.slice(1), events.slice(1), [], AXIS);
  const t = thin.rank.find((x) => x.key === "match" && x.target === "advance")!;
  assert.equal(t.state, "thin", "one class below the floor withholds the AUC");
  assert.equal(t.auc, null);
});

test("band audit: overturned automated advances above the bar vs person advances just below", () => {
  const entries: OutcomeEntry[] = [];
  const events: OutcomeEvent[] = [];
  const confidences: AdvanceConfidence[] = [];
  for (let i = 0; i < OUTCOME_RATE_FLOOR; i += 1) {
    const a = `a${i}`;
    entries.push(entry(a, 85));
    const adv = ev(a, "auto_advanced", "Screened", "Interview");
    events.push(adv);
    confidences.push({ entryId: a, kind: "auto_advanced", confidence: 90, at: adv.at });
    events.push(ev(a, "rejected", "Interview", "Interview")); // every one undone by a person
    const b = `b${i}`;
    entries.push(entry(b, 75));
    const hadv = ev(b, "advanced", "Screened", "Interview");
    events.push(hadv);
    confidences.push({ entryId: b, kind: "advanced", confidence: 75, at: hadv.at });
  }
  const r = computeScoreOutcomes(entries, events, confidences, AXIS);
  assert.equal(r.audit.bar, AUTO_ADVANCE_CONFIDENCE);
  assert.equal(r.audit.withConfidence, OUTCOME_RATE_FLOOR);
  assert.equal(r.audit.above.k, OUTCOME_RATE_FLOOR);
  assert.equal(r.audit.below.k, 0);
  assert.equal(r.audit.support, "raise-bar");

  // One short of the floor on either side: no rate, no support line.
  const thin = computeScoreOutcomes(entries, events, confidences.slice(1), AXIS);
  assert.equal(thin.audit.above.state, "thin");
  assert.equal(thin.audit.support, null);
});

test("an automated advance with NO sealed confidence is counted, but never audited", () => {
  const events = [ev("x", "auto_advanced", "Screened", "Interview")];
  const r = computeScoreOutcomes([entry("x", 90)], events, [], AXIS);
  assert.equal(r.audit.automatedAdvances, 1);
  assert.equal(r.audit.withConfidence, 0);
  assert.equal(r.audit.above.state, "empty");
});

test("drift pin: the bar is the Python screening policy's screen_advance_conf", () => {
  const py = readFileSync(path.join(here, "..", "..", "pipeline", "jobfit", "automation.py"), "utf8");
  const m = /"screen_advance_conf":\s*(\d+)/.exec(py);
  assert.ok(m, "screen_advance_conf not found in automation.py");
  assert.equal(Number(m[1]), AUTO_ADVANCE_CONFIDENCE);
});

test("drift pin: every kind read as a decision has the same author in DECISION_META", () => {
  const src = readFileSync(path.join(here, "decision-attribution.ts"), "utf8");
  for (const kind of ["advanced", "moved", "rejected", "reinstated", "auto_advanced", "auto_rejected", "offer_accepted"]) {
    const m = new RegExp(`\\n\\s*${kind}: \\{ auto: (true|false)`).exec(src);
    assert.ok(m, `${kind} missing from DECISION_META`);
    if (kind === "offer_accepted") continue; // the candidate's act, read as a hire, not a decision kind
    const expected = m[1] === "true" ? "automation" : "human";
    assert.equal(decisionAuthor({ kind, actor: null }), expected, kind);
  }
});
