// ADR 0027 S3 - the evidence ladder is descriptive: three rungs, each with its evidence
// and a reasons line or a plain empty state, and no aggregate anywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AI_TOOLS_COMPETENCY,
  EMPTY_CAUSES,
  LADDER_REASON_KEYS,
  defendedRung,
  evidenceLadder,
  quotedRung,
  watchedRung,
  type WatchedRung,
} from "./ladder.ts";

// The observed cast's WATCHED evidence, one row per archetype, written from the Python
// harness (pipeline/jobfit/tests/test_devcase_mid_archetype.py pins it to the live cast).
const FIXTURE = JSON.parse(readFileSync(new URL("./observed-cast.fixture.json", import.meta.url), "utf8")) as {
  rows: Record<string, { expected: string; bundle: unknown }>;
};

function watched(behavior: string): WatchedRung {
  const rung = watchedRung(true, FIXTURE.rows[behavior].bundle);
  assert.equal(rung.state, "evidence", behavior);
  return rung as WatchedRung;
}

test("watched: the mid partial verifier renders distinctly from strong and weak", () => {
  const strong = [watched("careful_verifier"), watched("ai_then_verify")];
  const mid = watched("ai_spot_check");
  const weak = [watched("big_bang_no_verify"), watched("ai_no_verify")];
  for (const s of strong) assert.ok(s.acts >= 2, `strong reads ${s.acts} acts`);
  assert.equal(mid.acts, 1, "the partial verifier: exactly one watched act");
  for (const w of weak) assert.equal(w.acts, 0);
  // The reasons line says it in words, so the three read differently on screen too.
  const line = (r: WatchedRung) => JSON.stringify(r.reasons);
  assert.notEqual(line(mid), line(strong[0]));
  assert.notEqual(line(mid), line(weak[0]));
  // What the mid caught, and what it did not: one planted defect of the graded set.
  assert.equal(mid.channels.editedTest, false);
  assert.ok(mid.channels.plantedCaught >= 1 && mid.channels.plantedCaught < mid.channels.plantedGraded);
});

test("watched: verification credit is channel-neutral, planted defects count once", () => {
  const bundle = (o: { editedTest?: boolean; ask?: number; stake?: number; canaries?: string[] }) => ({
    tooling: { signals: { editedTest: o.editedTest ?? false } },
    observedChecks: {
      promptSignals: { verificationAsks: o.ask ?? 0, stakeholderVerificationAsks: o.stake ?? 0 },
      canaryOutcomes: (o.canaries ?? []).map((status, i) => ({ id: `c${i}`, status })),
    },
  });
  const viaTest = watchedRung(true, bundle({ editedTest: true })) as WatchedRung;
  const viaAssistant = watchedRung(true, bundle({ ask: 1 })) as WatchedRung;
  const viaStakeholder = watchedRung(true, bundle({ stake: 1 })) as WatchedRung;
  const viaCanaries = watchedRung(true, bundle({ canaries: ["addressed", "flagged", "propagated", "unverifiable"] })) as WatchedRung;
  for (const r of [viaTest, viaAssistant, viaStakeholder, viaCanaries]) assert.equal(r.acts, 1);
  assert.deepEqual([viaCanaries.channels.plantedCaught, viaCanaries.channels.plantedGraded], [2, 3]);
});

test("watched: each empty state names its own cause", () => {
  assert.deepEqual(watchedRung(false, null), { rung: "watched", state: "empty", cause: "no_case" });
  assert.deepEqual(watchedRung(true, null), { rung: "watched", state: "empty", cause: "not_evaluated" });
  // A repository submission carries no observed signals: not watched, never "did not verify".
  assert.deepEqual(watchedRung(true, { tooling: { fluency: 0.5 } }), { rung: "watched", state: "empty", cause: "not_watched" });
});

test("watched: the witness verdict rides along and an unwitnessed trace costs nothing", () => {
  const b = (verdict: string) => ({ tooling: { signals: { editedTest: true } }, integrity: { witness: { verdict } } });
  const ok = watchedRung(true, b("witnessed")) as WatchedRung;
  const late = watchedRung(true, b("unwitnessed")) as WatchedRung;
  assert.equal(ok.witness, "witnessed");
  assert.equal(late.witness, "unwitnessed");
  assert.equal(ok.acts, late.acts, "the witness verdict never moves the count");
  assert.equal((watchedRung(true, b("bogus")) as WatchedRung).witness, "unknown");
});

test("defended: findings tally, adverse quotes, hold state, and the empty causes", () => {
  assert.equal(defendedRung(false, false, null).state, "empty");
  assert.deepEqual(defendedRung(true, false, null), { rung: "defended", state: "empty", cause: "not_evaluated" });
  assert.deepEqual(defendedRung(true, true, { total: 0, recorded: false }), { rung: "defended", state: "empty", cause: "no_followups" });
  assert.deepEqual(defendedRung(true, true, { total: 3, recorded: false, findings: [] }), { rung: "defended", state: "empty", cause: "not_recorded" });
  const r = defendedRung(true, true, {
    total: 3,
    recorded: true,
    held: true,
    clearedBy: null,
    findings: [
      { followupIndex: 1, kind: "supported" },
      { followupIndex: 2, kind: "revised", quote: "I let the assistant pick the retry policy." },
      { followupIndex: 3, kind: "not_asked" },
    ],
  });
  assert.equal(r.state, "evidence");
  if (r.state !== "evidence") return;
  assert.deepEqual(r.tally, { supported: 1, revised: 1, notEvidenced: 0, notAsked: 1, total: 3 });
  assert.deepEqual(r.quotes, [{ followupIndex: 2, kind: "revised", quote: "I let the assistant pick the retry policy." }]);
  assert.equal(r.hold, "held");
  assert.deepEqual(r.reasons[0], { key: "defendedSupported", values: { supported: 1, total: 3 } });
  const cleared = defendedRung(true, true, { total: 1, recorded: true, held: true, clearedBy: "rec-1", findings: [{ followupIndex: 1, kind: "supported" }] });
  assert.equal(cleared.state === "evidence" && cleared.hold, "cleared");
});

test("quoted: the S1 axis as rated, human and AI side by side, never averaged", () => {
  assert.equal(AI_TOOLS_COMPETENCY, "Working with AI tools");
  assert.deepEqual(quotedRung([], null), { rung: "quoted", state: "empty", cause: "not_rated" });
  const off = [{ ratings: [{ competency: "Communication", rating: 5 }] }];
  assert.equal(quotedRung(off, null).state, "empty", "another axis is not this rung's evidence");
  const r = quotedRung(
    [
      { authorLabel: "Ana", savedAt: "2026-10-20T10:00:00Z", ratings: [{ competency: AI_TOOLS_COMPETENCY, rating: 4, evidence: "Named the retry bug the tool wrote." }] },
      { authorLabel: null, savedAt: null, ratings: [{ competency: AI_TOOLS_COMPETENCY, rating: 2 }] },
    ],
    { ratings: [{ competency: AI_TOOLS_COMPETENCY, rating: 3, evidence: "Checks output." }] },
  );
  assert.equal(r.state, "evidence");
  if (r.state !== "evidence") return;
  assert.deepEqual(r.ratings.map((x) => [x.by, x.rating]), [["human", 4], ["human", 2], ["ai", 3]]);
  assert.equal(r.ratings[0].author, "Ana");
  assert.ok(r.reasons.some((x) => x.key === "quotedNoEvidence"), "a rating without words is said to be one");
});

test("the ladder carries no aggregate: no number spans the rungs", () => {
  const ladder = evidenceLadder({
    submission: true,
    evaluation: FIXTURE.rows.careful_verifier.bundle,
    debrief: { total: 1, recorded: true, findings: [{ followupIndex: 1, kind: "supported" }] },
    humanScorecards: [{ ratings: [{ competency: AI_TOOLS_COMPETENCY, rating: 5 }] }],
    aiInterview: null,
  });
  assert.deepEqual(Object.keys(ladder), ["watched", "defended", "quoted"]);
  for (const rung of Object.values(ladder)) assert.equal(rung.state, "evidence");
  const banned = ["score", "total", "overall", "level", "aggregate", "composite"];
  for (const key of banned) assert.ok(!(key in ladder), `no ladder-wide '${key}'`);
});

test("every reasons key and empty cause resolves in all four catalogs", () => {
  // The ladder emits only declared keys (LADDER_REASON_KEYS is the type of `key`), so the
  // catalog check is over the declaration; the emitted set must stay inside it.
  const emitted = new Set<string>();
  const add = (r: { state: string; reasons?: { key: string }[] }) => r.reasons?.forEach((x) => emitted.add(x.key));
  for (const b of Object.keys(FIXTURE.rows)) add(watchedRung(true, FIXTURE.rows[b].bundle));
  for (const v of ["witnessed", "neutral", "unwitnessed"]) add(watchedRung(true, { tooling: { signals: { editedTest: true } }, integrity: { witness: { verdict: v } } }));
  for (const k of emitted) assert.ok((LADDER_REASON_KEYS as readonly string[]).includes(k), k);
  for (const locale of ["en", "cs", "de", "fr"]) {
    const cat = JSON.parse(readFileSync(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8")) as {
      evidenceLadder: { reasons: Record<string, string>; empty: Record<string, string> };
    };
    for (const k of LADDER_REASON_KEYS) assert.equal(typeof cat.evidenceLadder.reasons[k], "string", `${locale}: evidenceLadder.reasons.${k}`);
    for (const c of EMPTY_CAUSES) assert.equal(typeof cat.evidenceLadder.empty[c], "string", `${locale}: evidenceLadder.empty.${c}`);
  }
});
