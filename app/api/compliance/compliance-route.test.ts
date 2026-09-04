// GET /api/compliance is the one route in the compliance area that sat outside the
// shaped envelope: no try/catch and a bare NextResponse.json. Its two reads are not
// infallible — getActiveRegimeId opens the decision-config store's OWN SQLite
// connection — so a locked, corrupt or unreachable database threw out of the handler
// and Next answered its framework 500, whose body is not `{ error, code }`. The two
// consumers both read a JSON body: AiDisclosure (the CANDIDATE-facing legal note) and
// decisionsComplianceState. What they got on that path was an unshaped error page, and
// the raw thrown message — SQLITE_* detail and the absolute db path — was the thing
// closest to reaching a public surface.
//
// This drives the REAL handler with the store virtualized, so both halves are pinned
// without a database: the happy envelope, and the coded failure whose body carries the
// generic sentence + COMPLIANCE_LOOKUP_FAILED and none of the thrown detail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const VIRTUAL_STORE = "kp-test:decision-config-store";
const RAW_THROW = "SQLITE_CANTOPEN: unable to open database file /srv/kp/data/kp.sqlite";

// The stub's behaviour is driven from here, per test.
const control: { regime: string; throws: boolean } = { regime: "us", throws: false };
(globalThis as { __kpComplianceStub?: typeof control }).__kpComplianceStub = control;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith("/decision-config-store") || specifier === "@/app/_lib/decision-config-store") {
      return { url: VIRTUAL_STORE, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === VIRTUAL_STORE) {
      return {
        format: "module",
        shortCircuit: true,
        source: `
          const c = globalThis.__kpComplianceStub;
          export function getActiveRegimeId() {
            if (c.throws) throw new Error(${JSON.stringify(RAW_THROW)});
            return c.regime;
          }
        `,
      };
    }
    return nextLoad(url, context);
  },
});

// Loaded AFTER the hooks — resolution hooks only affect later imports.
const { GET } = await import("./route.ts");

test("the happy answer is the shaped envelope: the caller's regime + the enforced retention window", async () => {
  control.throws = false;
  control.regime = "us";
  const res = await GET();
  assert.equal(res.status, 200);
  const body = (await res.json()) as { jurisdiction?: string; consentRetentionMonths?: number };
  assert.equal(body.jurisdiction, "us", "the regime the store answered for this workspace");
  // Derived from KP_CONSENT_TTL_DAYS, not hardcoded — the number the candidate-facing
  // consent sentence and the compliance posture both quote.
  assert.equal(typeof body.consentRetentionMonths, "number");
  assert.ok(body.consentRetentionMonths! > 0, "a retention window of zero months would be a false promise");
});

test("an unknown stored jurisdiction is normalized, never surfaced raw", async () => {
  control.throws = false;
  // A hand-edited config row, or one written by a build that knew a regime this one does not.
  control.regime = "atlantis";
  const body = (await (await GET()).json()) as { jurisdiction?: string };
  assert.equal(body.jurisdiction, "eu", "an unknown regime falls back to the EU default, not to undefined");
});

test("a store failure answers a CODE, and never the thrown message", async () => {
  control.throws = true;
  const res = await GET();
  assert.equal(res.status, 500);
  const body = (await res.json()) as { error?: string; code?: string };
  assert.equal(body.code, "COMPLIANCE_LOOKUP_FAILED", "the client resolves errors.<CODE> in the reader's language");
  assert.ok(body.error && body.error.length > 0, "the generic, client-safe sentence rides along");
  // The whole point: no SQLITE_* detail and no absolute db path on the wire.
  const wire = JSON.stringify(body);
  assert.doesNotMatch(wire, /SQLITE_/, "raw sqlite detail must not reach the client");
  assert.doesNotMatch(wire, /kp\.sqlite/, "the database path must not reach the client");
});
