// Council lite r1, robustness: three writers put a candidate's NAME into dev_audit's
// `reason`, and no erasure path reached that table. The fix has two halves — the writers
// stop recording the label and key the row by the outcome ref instead (this file), and
// anonymizeEntry de-identifies what is already there (erasure-full-scrub.test.ts). Each
// writer is driven for real below against a throwaway DB, and the row it leaves is read
// back from disk: not a mock of recordAudit, which would prove only the call.
//
// unit-db.ts must stay the first project import (isolated throwaway DB, open auth mode).
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import type { NextRequest } from "next/server";

// Same shims as app/api/devcase/control/control-authz.test.ts: next/server's connection()
// and next/headers cannot run outside a Next request scope.
register(new URL("./testing/next-server-hooks.mjs", import.meta.url));
const VIRTUAL_HEADERS = "kp-test:next-headers-audit-label";
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") return { url: VIRTUAL_HEADERS, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === VIRTUAL_HEADERS) {
      return {
        format: "module",
        shortCircuit: true,
        source: `
          export async function cookies() { return { get: () => undefined }; }
          export async function headers() { return new Headers(); }
          export async function draftMode() { return { isEnabled: false }; }
        `,
      };
    }
    return nextLoad(url, context);
  },
});

const { createPipelineEntry, actOnPipelineEntry } = await import("./db/pipeline.ts");
const { createOffer } = await import("./offers-store.ts");
const { respondToOffer } = await import("./offer-finalize.ts");
const { listAudit } = await import("./dev-control.ts");
const { hireOutcomeRef } = await import("./dev-outcomes.ts");
const { POST: outcomesPost } = await import("../api/devcase/outcomes/route.ts");

after(() => cleanupUnitDb());

const NAME = "Tereza Nováková";

function seed(stage: "Interview" | "Offer", submissionId: string) {
  const { entry } = createPipelineEntry({
    candidateId: `c-${submissionId}`,
    candidateLabel: NAME,
    jobId: `job-${submissionId}`,
    jobTitle: "Data Engineer",
    stage,
    contact: "tereza@example.com",
    devSubmissionId: submissionId,
  });
  return entry;
}

const auditFor = (action: string) => listAudit(500).filter((a) => a.action === action);

test("a reject of a promoted candidate audits the decision, keyed by the outcome ref, with no name", () => {
  const entry = seed("Interview", "sub_audit_reject");
  const result = actOnPipelineEntry(entry.id, "reject");
  assert.equal(result?.status, "rejected");
  const rows = auditFor("outcome_auto_recorded").filter((a) => a.ref === hireOutcomeRef(entry));
  assert.equal(rows.length, 1, "the row is findable by the same key dev_outcomes uses");
  assert.match(rows[0].reason ?? "", /^rejected \(predicted /, "the outcome and prediction are RETAINED");
  assert.doesNotMatch(JSON.stringify(rows), /Tereza|Nováková/, "no candidate label in the audit row");
});

test("an accepted offer audits the hire, keyed by the outcome ref, with no name", async () => {
  const entry = seed("Offer", "sub_audit_hire");
  const offer = createOffer({
    entryId: entry.id,
    candidateLabel: entry.candidateLabel,
    jobId: entry.jobId,
    jobTitle: "Data Engineer",
    currency: "USD",
    salary: 100000,
    payload: null,
  });
  const res = await respondToOffer(offer.token!, "accept");
  assert.equal(res.ok, true);
  const rows = auditFor("outcome_auto_recorded").filter((a) => a.ref === hireOutcomeRef(entry));
  assert.equal(rows.length, 1);
  assert.match(rows[0].reason ?? "", /^hired \(predicted /);
  assert.doesNotMatch(JSON.stringify(rows), /Tereza|Nováková/, "no candidate label in the audit row");
});

test("POST /api/devcase/outcomes audits the outcome and performance, keyed by ref, with no candidateRef", async () => {
  const req = new Request("http://localhost/api/devcase/outcomes", {
    method: "POST",
    body: JSON.stringify({ candidateRef: NAME, ref: "sub_audit_manual", outcome: "hired", performance: 4 }),
    headers: { "content-type": "application/json" },
  }) as unknown as NextRequest;
  const res = await outcomesPost(req);
  assert.equal(res.status, 200);
  const rows = auditFor("outcome_recorded").filter((a) => a.ref === "sub_audit_manual");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reason, "hired (perf 4)", "outcome and performance are RETAINED");
  assert.doesNotMatch(JSON.stringify(rows), /Tereza|Nováková/, "no candidate label in the audit row");
});
