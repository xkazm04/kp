// Pins: the live ResultPanel records a disposition once a slug exists.
//
// Advance/hold/pass used to live only on /history/[slug], so the recruiter's
// moment of decision on the live report had Add-to-pipeline but no human call.
// ResultPanel now mounts DispositionEditor when analysisSlug is set (live after
// persist, and the saved report), and omits it when the run is unsaved.
//
// No React renderer in this suite — the contract is read off the source.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("./ResultPanel.tsx", import.meta.url)), "utf8");
const history = readFileSync(fileURLToPath(new URL("../../history/[slug]/page.tsx", import.meta.url)), "utf8");
const live = readFileSync(fileURLToPath(new URL("../../features/tools/analyze/AnalyzeTab.tsx", import.meta.url)), "utf8");

test("self-check: ResultPanel.tsx was read", () => {
  assert.ok(src.includes("export function ResultPanel"), "ResultPanel.tsx did not parse as expected");
});

test("ResultPanel mounts DispositionEditor when analysisSlug is set", () => {
  assert.match(src, /import \{ DispositionEditor \} from "\.\/DispositionEditor"/);
  assert.match(src, /analysisSlug \? \(/);
  assert.match(
    src,
    /<DispositionEditor\s+slug=\{analysisSlug\}/,
    "the editor is addressed by the saved analysis slug",
  );
});

test("an unsaved run (no analysisSlug) omits the editor", () => {
  // The editor is inside the analysisSlug branch, never rendered on a persist miss.
  const editor = src.indexOf("<DispositionEditor");
  const guard = src.lastIndexOf("analysisSlug ?", editor);
  assert.ok(editor > 0 && guard > 0 && guard < editor, "DispositionEditor is behind analysisSlug");
  assert.doesNotMatch(src, /<DispositionEditor(?![^>]*slug=\{analysisSlug\})/);
});

test("the live tab already hands the slug through after persist", () => {
  assert.match(live, /analysisSlug=\{result\.analysis\.persistence\?\.slug/);
});

test("the saved report does not mount a second editor in its own header", () => {
  assert.doesNotMatch(history, /<DispositionEditor/);
  assert.match(history, /initialDisposition=\{found\.row\.disposition/);
  assert.match(history, /initialNote=\{found\.row\.decision_note/);
});
