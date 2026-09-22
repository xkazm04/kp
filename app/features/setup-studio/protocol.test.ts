import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseWizardTarget,
  normalizePlan,
  readCard,
  readHello,
  readResolved,
  parseMatrix,
  normalizeTts,
} from "./protocol.ts";

test("wizard fragment accepts only a local port and opaque token", () => {
  assert.deepEqual(parseWizardTarget("#wizard=4177&t=a_B-9.~"), { port: 4177, token: "a_B-9.~" });
  for (const hash of ["#wizard=0&t=ok", "#wizard=65536&t=ok", "#wizard=443&t=bad%2Ftoken", "#wizard=443&t="]) {
    assert.equal(parseWizardTarget(hash), null, hash);
  }
});

test("rejoin merges replay groups by sequence and includes terminal event", () => {
  const hello = readHello({
    replay: {
      probes: [{ seq: 2, type: "probe" }],
      narration: [{ seq: 1, type: "narration" }],
      cards: [{ seq: 3, type: "question" }],
      terminal: { seq: 4, type: "done" },
    },
  });
  assert.deepEqual(hello.replay.map((event) => event.type), ["narration", "probe", "question", "done"]);
  assert.deepEqual(readHello({}).replay, []);
});

test("wire parsers discard malformed choices and settle unknown outcomes", () => {
  assert.deepEqual(normalizePlan(["assess", "assess", "BAD ID", { id: "done", label: "" }]), [
    { id: "assess", label: "assess" },
    { id: "done", label: "done" },
  ]);
  assert.equal(readCard({ type: "future-card", id: "one" }), null);
  assert.equal(readCard({ type: "question", id: "" }), null);
  assert.deepEqual(readResolved({ id: "one", kind: "new-kind", outcome: "future", answer: ["A", 42, "B"] }), {
    id: "one", kind: null, outcome: "settled", answer: "A, B",
  });
});

test("matrix parser locates a moved state column and preserves non-table prose", () => {
  const matrix = parseMatrix("| Capability | Detail | State |\n| --- | --- | --- |\n| Email | relay | ready |\n| Voice | manual | open (dev) |");
  assert.deepEqual(matrix.rows.map((row) => row.state), ["on", "degraded"]);
  assert.deepEqual(matrix.rows[0].extra, [{ key: "Detail", value: "relay" }]);
  assert.deepEqual(parseMatrix("No capabilities yet."), { rows: [], prose: "No capabilities yet." });
});

test("TTS reader tolerates keyed provider maps and filters malformed voices", () => {
  const result = normalizeTts({
    providers: { local: { state: "ready", voices: ["voice-a", { id: "voice-b", lang: "cs" }, {}] } },
    allowed: ["local", 17],
  });
  assert.equal(result.providers[0].id, "local");
  assert.equal(result.providers[0].ready, true);
  assert.deepEqual(result.providers[0].voices.map((voice) => voice.id), ["voice-a", "voice-b"]);
  assert.deepEqual(result.allowed, ["local"]);
});
