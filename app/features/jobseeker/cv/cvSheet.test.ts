import { test } from "node:test";
import assert from "node:assert/strict";
import { cssString, emphasisRanges, skillText } from "./cvSheet";

test("the running head's CSS string cannot leave its literal, whatever the seeker's name", () => {
  assert.equal(cssString("Jörg Weißhaupt"), '"Jörg Weißhaupt"');
  assert.equal(cssString("Jana O'Neill-Nováková"), `"Jana O'Neill-Nováková"`);
  const hostile = cssString('x"}</style><script>alert(1)</script>\\');
  assert.ok(!/["\\](?![0-9a-f])/.test(hostile.slice(1, -1).replace(/\\[0-9a-f]+ /g, "")), hostile);
  assert.ok(!hostile.includes("<") && !hostile.includes("}"), hostile);
  assert.equal(cssString("a\nb"), '"a\\a b"');
});

test("a skill's level is its WORD after the name, never a meter; no word, no level", () => {
  assert.equal(skillText({ name: "Kubernetes", level: "expert" }), "Kubernetes (expert)");
  assert.equal(skillText({ name: "Pohoda", level: "pokročilá" }), "Pohoda (pokročilá)");
  assert.equal(skillText({ name: "Git", level: null }), "Git");
});

test("emphasis: each term bold once, whole words only, any case, never overlapping", () => {
  const text = "Built a RAG pipeline in Python; python scripts fed the RAG index.";
  assert.deepEqual(emphasisRanges(text, ["python", "RAG", "rag index"]), [
    [8, 11],
    [24, 30],
    [55, 64],
  ]);
  // An overlapping term loses to the earlier one.
  assert.deepEqual(emphasisRanges("RAG pipeline", ["rag pipeline", "pipeline"]), [[0, 12]]);
  assert.deepEqual(emphasisRanges("Typescript and TypeScripted", ["typescript"]), [[0, 10]]);
  assert.deepEqual(emphasisRanges("Go and Golang", ["go"]), [[0, 2]]);
  assert.deepEqual(emphasisRanges("abc", undefined), []);
  assert.deepEqual(emphasisRanges("abc", ["zzz", " "]), []);
});
