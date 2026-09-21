// ChatComposer is TSX, so this gate reads the source. Placeholder is not a
// name: it disappears once the operator types, and many AT skip it. The
// textarea must read labels.composerLabel.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

test("the composer textarea reads labels.composerLabel, not a placeholder-as-name", () => {
  const composer = readFileSync(path.join(HERE, "ChatComposer.tsx"), "utf8");
  assert.match(composer, /aria-label=\{labels\.composerLabel\}/);
  const labels = readFileSync(path.join(HERE, "ChatTranscript.tsx"), "utf8");
  assert.match(labels, /composerLabel:\s*string/, "ChatLabels requires the field so every caller fills it");
});
