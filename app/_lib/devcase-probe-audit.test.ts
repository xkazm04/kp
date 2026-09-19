import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  auditProbe,
  auditProbeStrength,
  enforceProbeGate,
  PROBE_ISSUE_CODES,
} from "./devcase-probe-audit.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOCALES = ["en", "cs", "de", "fr"] as const;

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
  assert.equal(a.issues[0], "no_choice");
});

test("duplicate options collapse below the distinct minimum", () => {
  const a = auditProbe({ ...good("p1"), decisionSpace: ["Cache it", " cache it ", "CACHE IT"] });
  assert.equal(a.loadBearing, false);
});

test("missing where (no seam) and missing reveals each flag", () => {
  const a = auditProbe({ ...good("p1"), where: "  ", reveals: "" });
  assert.equal(a.loadBearing, false);
  assert.deepEqual(a.issues, ["no_seam", "no_reveals"]);
});

test("auditProbe issues are catalog keys present in all four locales", () => {
  assert.deepEqual([...PROBE_ISSUE_CODES], ["no_choice", "no_seam", "no_reveals"]);
  for (const locale of LOCALES) {
    const cat = JSON.parse(readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8")) as {
      devcase?: { probeAudit?: { issue?: Record<string, string> } };
    };
    const issue = cat.devcase?.probeAudit?.issue ?? {};
    for (const code of PROBE_ISSUE_CODES) {
      assert.ok(issue[code]?.trim(), `messages/${locale}.json devcase.probeAudit.issue.${code}`);
    }
  }
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

test("a blocked probe gate returns the code, not an English paragraph", () => {
  const r = enforceProbeGate([], false);
  assert.equal(r.ok, false);
  if (r.ok === false) {
    assert.equal(r.code, "probe_audit_failed");
    assert.equal(r.error, "probe_audit_failed");
  }
});
