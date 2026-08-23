import { test } from "node:test";
import assert from "node:assert/strict";
import { speechReady } from "./text/normalize.ts";
import { segmentSpeech } from "./text/segment.ts";
import { concatWav, pcmToWav, wavInfo } from "./node/wav.ts";
import { silentWav } from "./providers/fake.ts";

test("speechReady strips markup, keeps anchor text, drops code/urls/emoji", () => {
  const md = [
    "## Summary",
    "We **shipped** the _fix_ — see [the PR](https://example.com/pr/1) 🎉",
    "- first item",
    "- second item",
    "```ts",
    "const x = 1;",
    "```",
    "| a | b |",
    "| 1 | 2 |",
    "Run `npm test` and email me@example.com.",
  ].join("\n");
  const out = speechReady(md, { codePlaceholder: "there is a code sample" });
  assert.equal(out, "Summary. We shipped the fix — see the PR. first item. second item. there is a code sample. Run npm test and email.");
});

test("segmentSpeech respects abbreviations, decimals and Czech ordinal dots", () => {
  const s = segmentSpeech("Dr. Novák přijde 7. dubna v 14.30. Cena je 3.5 milionu Kč. Díky!", { minChars: 10 });
  // The trailing "Díky!" is shorter than minChars and merges backward by design.
  assert.deepEqual(s, ["Dr. Novák přijde 7. dubna v 14.30.", "Cena je 3.5 milionu Kč. Díky!"]);
});

test("segmentSpeech merges short sentences and force-splits long ones under maxChars", () => {
  const long = Array.from({ length: 12 }, (_, i) => `clause number ${i + 1} is here`).join(", ") + ".";
  const parts = segmentSpeech(`Hi. Yes. ${long}`, { minChars: 40, maxChars: 120, firstChunkClause: false });
  assert.ok(parts.every((p) => p.length <= 120), parts.map((p) => p.length).join());
  assert.ok(parts[0].startsWith("Hi. Yes."));
});

test("first chunk may stop at a clause mark to win time-to-first-audio", () => {
  const parts = segmentSpeech(
    "Thanks for joining today, I am the assistant running this short screen and everything is transcribed for the recruiter to read later.",
    { minChars: 20, maxChars: 280 },
  );
  assert.equal(parts[0], "Thanks for joining today,");
  assert.equal(parts.length, 2);
});

test("wav helpers: pcm wrap, info, concat of equal formats", () => {
  const a = silentWav(100);
  const b = pcmToWav(new Uint8Array(400), 16000);
  const joined = concatWav([a, b], "piper");
  const info = wavInfo(joined);
  assert.equal(info.sampleRate, 16000);
  assert.equal(info.dataBytes, 200 + 400);
  assert.throws(() => concatWav([a, pcmToWav(new Uint8Array(4), 24000)], "piper"));
});
