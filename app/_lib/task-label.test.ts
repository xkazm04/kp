// The task-label seam: a background task's display name is written by the SERVER at
// enqueue time, with no request locale, and read later by whoever has the screen open
// — so the column stores a `{ k, v }` catalog reference and the UI resolves it. That
// makes encode/decode a wire format between two processes' worth of time, and it had
// no test at all: a change to the sentinel, the JSON shape or the fallback order would
// have shown up as blank or English task rows in the tray, days later.
//
// Pure module (no DB, no next-intl runtime) — the translator is the minimal structural
// shape renderTaskLabel declares.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeTaskLabel, encodeTaskLabel, renderTaskLabel } from "./task-label.ts";

// A stand-in for next-intl's scoped translator: `has` over a fixed key set, and a call
// that renders the key plus its values so the test can see WHAT was passed through.
function translator(keys: string[]) {
  const known = new Set(keys);
  const t = ((key: string, values?: Record<string, string | number>) =>
    `${key}(${JSON.stringify(values ?? null)})`) as unknown as {
    has: (key: never) => boolean;
  };
  (t as unknown as { has: (k: string) => boolean }).has = (k: string) => known.has(k);
  return t;
}

test("a label round-trips through encode/decode with its values typed", () => {
  const ref = decodeTaskLabel(encodeTaskLabel("batchOutreach", { n: 8 }));
  assert.deepEqual(ref, { k: "batchOutreach", v: { n: 8 } });
  // THE reason values are not stringified: `intl-messageformat` renders the literal
  // word "NaN" for a pre-formatted number in an ICU plural.
  assert.equal(typeof ref!.v!.n, "number");
});

test("no values means no `v` key at all, not an empty object", () => {
  const encoded = encodeTaskLabel("batchScreen");
  assert.equal(encoded.includes('"v"'), false, "an empty bag must not ride the column");
  assert.deepEqual(decodeTaskLabel(encoded), { k: "batchScreen", v: undefined });
  // An explicitly empty bag collapses the same way, so two callers writing the same
  // label cannot produce two different column values.
  assert.equal(encodeTaskLabel("batchScreen", {}), encoded);
});

test("decode refuses anything that is not one of our references", () => {
  for (const notOurs of [
    null,
    undefined,
    "",
    "Analyzing 3 CVs", // a legacy row written before this seam existed
    '{"k":"analyze"}', // valid JSON, but no sentinel — a coincidence, not a reference
    "kp.tl:not json",
    "kp.tl:null",
    "kp.tl:[1,2]",
    'kp.tl:{"v":{"n":1}}', // no key
    'kp.tl:{"k":""}', // empty key
    'kp.tl:{"k":42}', // key of the wrong type
  ]) {
    assert.equal(decodeTaskLabel(notOurs as string | null), null, `must not decode: ${String(notOurs)}`);
  }
});

test("a non-object `v` is dropped rather than handed to the formatter", () => {
  // Defensive: the column is durable, so a row written by an older/other build must
  // degrade to "key, no values" instead of throwing inside the render.
  assert.deepEqual(decodeTaskLabel('kp.tl:{"k":"analyze","v":"nope"}'), { k: "analyze", v: undefined });
});

test("render resolves a known reference through the catalog", () => {
  const t = translator(["kind.analyze"]);
  assert.equal(
    renderTaskLabel(t, { label: encodeTaskLabel("analyze", { label: "CV +2" }), kind: "analyze" }),
    'kind.analyze({"label":"CV +2"})'
  );
});

test("render falls back through label, then kind — never to an empty cell", () => {
  const t = translator(["kind.analyze"]);
  // A legacy English sentence is rendered verbatim: no migration was ever needed.
  assert.equal(renderTaskLabel(t, { label: "Analyzing 3 CVs", kind: "analyze" }), "Analyzing 3 CVs");
  // No label at all ⇒ the raw kind, so the row is still identifiable.
  assert.equal(renderTaskLabel(t, { label: null, kind: "group_eval" }), "group_eval");
  // A reference whose key the catalog does not carry (a kind added after this
  // deployment's messages, or a key renamed) ⇒ the kind, NOT the encoded blob. The
  // sentinel string must never reach a reader.
  const rendered = renderTaskLabel(t, { label: encodeTaskLabel("brandNewKind"), kind: "brand_new" });
  assert.equal(rendered, "brand_new");
  assert.equal(rendered.includes("kp.tl:"), false);
});
