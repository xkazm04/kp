// The Dev studio never loads the workspace postings fold (challenge-r09
// devcase-lifecycle/A).
//
// GET /api/devcase/postings inlines every submission of every posting, joins outcomes
// and computes a promote verdict per evaluated submission. The studio used to load it on
// mount and after every evaluation, only to filter it down to one case (the detail) or
// fold it into two counts per case (the lifecycle section). The detail now reads its own
// case's channels by id and the lifecycle rows carry their counts; the workspace route
// stays for the e2e journeys that read it. This pins that the studio's mount does not
// come back to it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (name: string) => readFileSync(path.join(here, name), "utf8");

test("useDevTabData.ts does not request /api/devcase/postings", () => {
  assert.ok(!src("useDevTabData.ts").includes("/api/devcase/postings"));
});

test("LifecycleSection takes no `postings` prop and reads its counts off the row", () => {
  const section = src("DevLifecycleSection.tsx");
  const props = section.slice(section.indexOf("export function LifecycleSection"), section.indexOf(") {", section.indexOf("export function LifecycleSection")));
  assert.ok(props.length > 0, "the component signature was found");
  assert.ok(!/\bpostings\b/.test(props), `LifecycleSection must not take postings:\n${props}`);
  assert.match(section, /lc\.submissionCount/);
  assert.match(section, /lc\.inFlight/);
});

test("the detail reader fetches its own channels by id and filters no workspace fold", () => {
  assert.match(src("DevTabCasesView.tsx"), /\/channels`/);
  assert.ok(!/postings\.filter\(/.test(src("DevCaseDetail.tsx")), "no client-side filter down to one case");
});

test("NON-VACUITY: the prop probe catches a postings prop", () => {
  const leaky = "export function LifecycleSection({\n  lifecycles,\n  postings,\n}: { lifecycles: L[]; postings: P[] }) {";
  const props = leaky.slice(leaky.indexOf("export function LifecycleSection"), leaky.indexOf(") {"));
  assert.ok(/\bpostings\b/.test(props));
});
