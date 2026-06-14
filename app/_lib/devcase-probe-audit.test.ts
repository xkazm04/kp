import { test } from "node:test";
import assert from "node:assert/strict";
import { auditProbe, auditProbeStrength } from "./devcase-probe-audit.ts";

const good = (id: string) => ({
  id,
  kind: "ambiguity",
  where: "task 1 / config loader",
  reveals: "clarify vs assume the default",
  decisionSpace: ["Ask for the intended default", "Assume env-var precedence"],
});

test("a complete probe is load-bearing with no issues", () => {
  const a = auditProbe(good("p1"));
  assert.equal(a.loadBearing, true);
  assert.deepEqual(a.issues, []);
});

test("a decisionSpace with fewer than two distinct options can't force a choice", () => {
  const a = auditProbe({ ...good("p1"), decisionSpace: ["Only one option"] });
  assert.equal(a.loadBearing, false);
  assert.match(a.issues[0], /forced choice/i);
});

test("duplicate options collapse below the distinct minimum", () => {
  const a = auditProbe({ ...good("p1"), decisionSpace: ["Cache it", " cache it ", "CACHE IT"] });
  assert.equal(a.loadBearing, false);
});

test("missing where (no seam) and missing reveals each flag", () => {
  const a = auditProbe({ ...good("p1"), where: "  ", reveals: "" });
  assert.equal(a.loadBearing, false);
  assert.equal(a.issues.length, 2);
});

test("verdict strong needs ≥2 load-bearing and a majority", () => {
  const audit = auditProbeStrength([good("p1"), good("p2"), { id: "p3" }]);
  assert.equal(audit.loadBearing, 2);
  assert.equal(audit.total, 3);
  assert.equal(audit.verdict, "strong"); // 2 of 3, ≥2
});

test("verdict weak when a minority are load-bearing", () => {
  const audit = auditProbeStrength([good("p1"), { id: "p2" }, { id: "p3" }, { id: "p4" }]);
  assert.equal(audit.loadBearing, 1);
  assert.equal(audit.verdict, "weak");
});

test("verdict none when nothing discriminates", () => {
  assert.equal(auditProbeStrength([]).verdict, "none");
  assert.equal(auditProbeStrength([{ id: "p1" }]).verdict, "none");
});
