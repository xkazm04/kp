// Pins the empty-catalog launchpad doors (scan-sweep jobs-table-core).
// Route 2 used to render inert coral text; it is a button bound to `onImport`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const launchpad = readFileSync(path.join(dir, "JobsEmptyLaunchpad.tsx"), "utf8").replace(/\r\n/g, "\n");
const tab = readFileSync(path.join(dir, "JobsTab.tsx"), "utf8").replace(/\r\n/g, "\n");
const results = readFileSync(path.join(dir, "JobsTabResults.tsx"), "utf8").replace(/\r\n/g, "\n");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

test("the launchpad import CTA is a button that invokes onImport", () => {
  const src = code(launchpad);
  assert.match(src, /onImport\?: \(\) => void/);
  assert.match(src, /onClick=\{onImport\}/);
  assert.match(src, /type="button"/);
  assert.match(src, /onClick=\{onClick\}/);
});

test("the launchpad draft CTA points at Job intake, not the JD shelf", () => {
  const src = code(launchpad);
  assert.match(src, /tab="intake"/);
  assert.equal(/tab="library"/.test(src), false);
});

test("JobsTab opens the ingest panel from the launchpad import CTA", () => {
  assert.match(code(tab), /onImport=\{\(\) => ingest\.setOpen\(true\)\}/);
  assert.match(code(results), /<JobsEmptyLaunchpad onImport=\{onImport\} \/>/);
});
