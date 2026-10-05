// Source guards for level 1's editors (kp's convention for a client hook with no render harness): the
// decisions themselves are unit-tested in setupDelivery.test.ts; these pin that the hooks ACT on them.
// They took over the retired cards' guards (channelsRelayInvalidation.test.ts over the relay card,
// channelsEdgeDrainRefusal.test.ts over the edge card) assertion for assertion: the capability
// announcement on save and on a 409 adopt, the drain's status-first read, the class map's totality
// (setupDelivery.test.ts), and every refusal resolved from its code with a localized fallback.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(path.join(DIR, f), "utf-8").replace(/\r\n/g, "\n");

/** The text of the `{ … }` block that opens right after `marker`. */
function blockAfter(src: string, marker: string): string {
  const at = src.indexOf(marker);
  assert.ok(at >= 0, `marker not found: ${marker}`);
  const open = src.indexOf("{", at + marker.length - 1);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error(`unbalanced block after ${marker}`);
}

test("a relay save and a 409 adopt both announce the capability change", () => {
  const src = read("useRelaySetup.ts");
  const saved = blockAfter(src, 'if (outcome.kind === "saved") {');
  assert.match(saved, /invalidateCommsCapability\(\)/);
  assert.match(saved, /notifyDataChanged\(\)/);
  const stale = blockAfter(src, 'if (outcome.kind === "stale") {');
  assert.match(stale, /invalidateCommsCapability\(\)/);
  assert.match(stale, /notifyDataChanged\(\)/);
});

test("refusals resolve from their code, never from the server's prose", () => {
  for (const f of ["useRelaySetup.ts", "useEdgeSetup.ts", "SetupPullForm.tsx", "SetupAddReceiver.tsx", "SetupCvSim.tsx", "SetupRelay.tsx"]) {
    const src = read(f);
    assert.match(src, /errMsg\(/, `${f} must resolve refusals through useErrorMessage`);
    assert.doesNotMatch(src, /\.error\b(?!Kind)/, `${f} reads a server \`error\` string`);
  }
});

test("the drain reads its outcome status-first and reports a failure by class", () => {
  const src = read("useEdgeSetup.ts");
  assert.match(src, /drainOutcome\(r\.ok,/, "the drain must hand the response STATUS to drainOutcome");
  assert.match(src, /DRAIN_FAIL_KEY\[out\.errorKind\]/);
  // A refusal without a class (a 403 / 500 carries no summary) is the failure style, from its code,
  // with a localized sentence as the fallback, never the green "drained" one.
  assert.match(src, /else setNote\(\{ ok: false, text: errMsg\(out\.body, t\("drainFailedUnknown"\)\) \}\)/);
  const drained = src.indexOf('out.kind === "drained"');
  assert.ok(drained > src.indexOf("drainOutcome(r.ok,"), "the outcome is read from the status before a success is chosen");
});

test("enabling sealing reports its refusal by code", () => {
  assert.match(read("useEdgeSetup.ts"), /errMsg\(d, t\("sealFailed"\)\)/);
});

test("a stored secret is never rendered: the secret field shows a mask, and a typed one only on request", () => {
  const src = read("SetupSecretField.tsx");
  assert.match(src, /type=\{shown \? "text" : "password"\}/);
  assert.match(src, /autoComplete="new-password"/);
});
