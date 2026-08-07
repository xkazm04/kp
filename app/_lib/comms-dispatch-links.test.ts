// Pins the ABSOLUTE-link contract for candidate comms (backlog #35a /
// capst-l2-102): the GDPR erasure footer — the one self-service pathway the
// consent copy promises — and the onboarding link footer must resolve through
// the shared publicBaseUrl precedence to an ABSOLUTE URL. A relative
// "/data/er-…" path is dead in every mail client, while the status link beside
// it was already absolute. When nothing resolves (detached send, no env), the
// dispatcher warns loudly instead of failing silently.
//
// Runs against an ISOLATED throwaway DB (testing/unit-db.ts must stay the first
// project import; it also clears APP_BASE_URL / NEXT_PUBLIC_APP_BASE_URL so the
// tests own the env).
import { test, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { createPipelineEntry } from "./db/pipeline.ts";
import { dispatchRejection, dispatchOnboarding } from "./comms-dispatch.ts";
import { listOutboxFiltered } from "./db/devcase.ts";

after(() => cleanupUnitDb());
afterEach(() => {
  delete process.env.APP_BASE_URL;
});

let seq = 0;
function entryFixture() {
  seq += 1;
  return createPipelineEntry({
    candidateId: `cdl-c${seq}`,
    candidateLabel: `Comms Link Candidate ${seq}`,
    jobId: `cdl-job-${seq}`,
    jobTitle: "Comms Link Role",
  }).entry;
}

test("dispatched rejection body carries an ABSOLUTE erasure URL when a public origin is configured", async () => {
  process.env.APP_BASE_URL = "https://kp.example.com";
  const entry = entryFixture();

  await dispatchRejection(entry);

  const rows = listOutboxFiltered({ ref: entry.id, kind: "rejection" });
  assert.equal(rows.length, 1, "the rejection landed in the outbox");
  const body = rows[0].body ?? "";
  assert.match(
    body,
    /https:\/\/kp\.example\.com\/data\/[A-Za-z0-9_~.-]+/,
    "the GDPR footer link must be absolute — resolved via publicBaseUrl like the status link beside it"
  );
  assert.ok(!/\s\/data\//.test(body), "no bare relative /data/ path may ship in an email body");
});

test("onboarding welcome carries an ABSOLUTE onboarding link (same defect class as the erasure footer)", async () => {
  process.env.APP_BASE_URL = "https://kp.example.com";
  const entry = entryFixture();

  await dispatchOnboarding(entry, "tok-unit-onboarding");

  const rows = listOutboxFiltered({ ref: entry.id, kind: "onboarding" });
  assert.equal(rows.length, 1);
  assert.ok(
    (rows[0].body ?? "").includes("https://kp.example.com/onboarding/tok-unit-onboarding"),
    "the onboarding link must be absolute"
  );
});

test("no origin resolvable (detached send, env unset): the footer still renders and the dispatcher warns loudly", async () => {
  const entry = entryFixture();
  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
  try {
    await dispatchRejection(entry);
  } finally {
    console.warn = realWarn;
  }

  const rows = listOutboxFiltered({ ref: entry.id, kind: "rejection" });
  assert.equal(rows.length, 1);
  // The legal affordance is never silently dropped …
  assert.match(rows[0].body ?? "", /\/data\/[A-Za-z0-9_~.-]+/, "the erasure footer still renders");
  // … but the misconfiguration is loud instead of a silent dead link.
  assert.ok(
    warnings.some((w) => w.includes("[comms]") && w.includes("APP_BASE_URL")),
    "a dead-relative-link send must warn about the missing public origin"
  );
});
