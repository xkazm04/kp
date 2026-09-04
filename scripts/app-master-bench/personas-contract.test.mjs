// The drift test between the two Personas doubles.
//
//   node --test scripts/app-master-bench/personas-contract.test.mjs
//   npm run test:bench-driver
//
// `stub.mjs` opened with "It is a port of e2e/fixtures/mock-personas-bridge.ts"
// and nothing ever checked it. Both are hand-written stand-ins for ONE real API,
// each maintained on a different day for a different harness; a route the bench
// stub answers 200 and the e2e mock answers 404 is a contract question nobody
// asked, and it can only be answered by a production call failing.
//
// So both are driven through the SAME probe (personas-contract.mjs, derived from
// app/_lib/agent-hire/{pairing,bridge-client}.ts) and must both conform. The
// differences that are deliberate are declared there and asserted here in BOTH
// directions — a double that quietly stops diverging fails just as loudly as one
// that quietly starts.
//
// The mock is TypeScript; node's type stripping loads it directly, which is why
// its `AddressInfo` import is `import type` (a value import of a type is not
// erasable syntax and would fail here first).
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONTRACT_SOURCES, DECLARED_DIVERGENCES, checkContract } from "./personas-contract.mjs";
import { startStubPersonas } from "./stub.mjs";
import { startMockPersonasBridge } from "../../e2e/fixtures/mock-personas-bridge.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Run one double through the probe and always close it. */
async function probe(start) {
  const double = await start();
  try {
    return await checkContract(double.url);
  } finally {
    await double.close();
  }
}

const divergence = (id) => {
  const found = DECLARED_DIVERGENCES.find((d) => d.id === id);
  assert.ok(found, `no declared divergence "${id}"`);
  return found;
};

test("the bench stub conforms to the Personas bridge contract", async () => {
  const { findings } = await probe(startStubPersonas);
  assert.deepEqual(findings, [], `stub.mjs left the contract:\n  - ${findings.join("\n  - ")}`);
});

test("the e2e mock bridge conforms to the same contract", async () => {
  const { findings } = await probe(startMockPersonasBridge);
  assert.deepEqual(findings, [], `mock-personas-bridge.ts left the contract:\n  - ${findings.join("\n  - ")}`);
});

test("every declared divergence is still real, in both doubles", async () => {
  const stub = await probe(startStubPersonas);
  const mock = await probe(startMockPersonasBridge);
  for (const d of DECLARED_DIVERGENCES) {
    assert.deepEqual(
      stub.observations[d.probe],
      d.stub,
      `divergence "${d.id}": the STUB's ${d.probe} is ${JSON.stringify(stub.observations[d.probe])}, declared ${JSON.stringify(d.stub)}. ` +
        `Either the stub changed and the declaration must follow, or this is drift.\n${d.why}`,
    );
    assert.deepEqual(
      mock.observations[d.probe],
      d.mock,
      `divergence "${d.id}": the MOCK's ${d.probe} is ${JSON.stringify(mock.observations[d.probe])}, declared ${JSON.stringify(d.mock)}.\n${d.why}`,
    );
    assert.notDeepEqual(
      d.stub,
      d.mock,
      `divergence "${d.id}" declares the same value for both doubles — that is not a divergence, delete the row`,
    );
    assert.ok(d.why.length > 80, `divergence "${d.id}" must explain itself; a bare "they differ" is what this file exists to replace`);
  }
});

test("the headless-vs-pending claim ladder is the difference, stated out loud", () => {
  // The one people actually trip on: the bench NEVER exercises the pairing WAIT,
  // because the stub's headless bridge hands the key over on the first claim.
  // Only the e2e mock walks the human ladder, so only the e2e journey can prove
  // kp renders "waiting for approval" correctly.
  const d = divergence("claim-ladder");
  assert.equal(d.mock, 2, "the mock's first claim must stay a pending beat — it is the only place kp's pairing WAIT is exercised");
  assert.equal(d.stub, 1, "the stub is a headless bridge: no human, so the first claim carries the key");
  assert.match(d.why, /headless/i);
});

test("the probe is not vacuous: a permissive double fails it loudly", async () => {
  // A conformance probe that passes everything certifies nothing, and both real
  // doubles pass today — so the probe's own teeth need their own witness. This
  // server is the classic wrong double: it says yes to every request, which
  // means it never refuses an unauthenticated management call, never 404s a
  // stranger's nonce, and never mints a pk_ key.
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { findings } = await checkContract(`http://127.0.0.1:${server.address().port}`);
    assert.ok(findings.length >= 5, `a yes-to-everything double produced only ${findings.length} findings`);
    assert.ok(findings.some((f) => f.includes("/pair/request without Origin")), findings.join("\n"));
    assert.ok(findings.some((f) => f.includes("unregistered nonce")), findings.join("\n"));
    assert.ok(findings.some((f) => f.includes("never handed a token over")), findings.join("\n"));
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("the probe still points at the real callers it was derived from", () => {
  // A contract copied out of one of the doubles would only ever certify the
  // copy. These are the two kp files that actually dial the bridge — if one is
  // moved or renamed, the probe's provenance has to be re-established by hand,
  // and this is where that gets noticed.
  assert.ok(CONTRACT_SOURCES.length > 0);
  for (const source of CONTRACT_SOURCES) {
    assert.ok(
      existsSync(path.join(REPO_ROOT, source)),
      `personas-contract.mjs says it is derived from ${source}, which no longer exists`,
    );
  }
});
