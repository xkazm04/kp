// ONE shape for the quota refusal, tree-wide.
//
// `meterGate` (app/_lib/billing/enforce.ts) answers a VERDICT, not a response, and six
// routes used to put that object straight on the wire with `NextResponse.json(quota,
// { status: 402 })`. That worked only for as long as the verdict's fields happened to
// match what `jsonRefusal` builds — a coincidence, not a contract, and exactly the
// drift that left the refusal carrying an unregistered `quota_exceeded` code for so
// long. Every 402 quota door now goes through the chokepoint, and this guard is what
// keeps the next one from re-hand-rolling it.
//
// Line endings normalised first: this checkout is CRLF while the worktree may be LF.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { REFUSAL_ERRORS } from "../_lib/api-response.ts";
import { QUOTA_CODE, QUOTA_MESSAGE } from "../_lib/billing/enforce.ts";

const apiDir = path.dirname(fileURLToPath(import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules") walk(p, out);
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
      out.push(p);
    }
  }
  return out;
}

const MODULES = walk(apiDir).map((file) => ({
  rel: path.relative(apiDir, file).split(path.sep).join("/"),
  src: readFileSync(file, "utf8").replace(/\r\n/g, "\n"),
}));

test("no handler serializes a meterGate verdict onto the wire itself", () => {
  // The verdict is a DECISION object. Rendering it directly makes every field of it a
  // wire contract by accident, and skips the one place that pairs a code with its
  // registered sentence.
  // Scoped to a 402 answer: `NextResponse.json(verdict)` at 200 elsewhere in the tree
  // (the LLM key-test routes) is a different word for a different thing.
  const offenders = MODULES.filter((m) =>
    /NextResponse\.json\(\s*(?:\w+\.)?\w*(?:quota|reserve|verdict)\w*\s*,\s*\{\s*status:\s*402/i.test(m.src)
  );
  assert.deepEqual(offenders.map((m) => m.rel), [], "return jsonRefusal(QUOTA_CODE, 402, { meter, plan }) instead");
});

test("no handler hand-rolls a 402 body around the quota code or its sentence", () => {
  // Catches the other half: an { error: …, code: "BILLING_QUOTA_EXCEEDED" } literal, or
  // the English sentence copied into a route, both answered at 402 without the helper.
  const offenders = MODULES.filter((m) => {
    const hasLiteral = m.src.includes(`"${QUOTA_CODE}"`) || m.src.includes(QUOTA_MESSAGE);
    return hasLiteral && !/jsonRefusal\(\s*"BILLING_QUOTA_EXCEEDED"/.test(m.src);
  });
  assert.deepEqual(offenders.map((m) => m.rel), []);
});

test("every 402 under app/api answers through the chokepoint", () => {
  const offenders = MODULES.filter((m) => /status:\s*402/.test(m.src) && !/jsonRefusal\(/.test(m.src));
  assert.deepEqual(offenders.map((m) => m.rel), [], "402 is a refusal like any other");
});

test("the quota code the routes name is the registered one", () => {
  assert.equal(QUOTA_CODE, "BILLING_QUOTA_EXCEEDED");
  assert.equal(REFUSAL_ERRORS[QUOTA_CODE], QUOTA_MESSAGE);
  // And the routes that gate a meter actually reach it — a guard that would pass on an
  // empty tree is not a guard.
  const users = MODULES.filter((m) => /jsonRefusal\(\s*"BILLING_QUOTA_EXCEEDED"/.test(m.src)).map((m) => m.rel);
  assert.deepEqual(users.sort(), [
    "analyze/route.ts",
    "devcase/lifecycle/[id]/redesign/route.ts",
    "devcase/lifecycle/route.ts",
    "interview/create/route.ts",
    "interview/simulate/route.ts",
    "jobs/[id]/publish/route.ts",
  ]);
});
