import { test } from "node:test";
import assert from "node:assert/strict";
import { REFERENCE_CVS } from "./__fixtures__/referenceCvs";
import { checkRoundTrip, cvReadingLines, ROUND_TRIP_CHECKS, type RoundTripCheck } from "./cvRoundTrip";

// The pure half of the designed CV's round trip (registry
// recruiting/cv-presentation-and-parseability, export-format-and-round-trip-verification).
// The render + extract half is `npm run cv:roundtrip` (a browser and Python); this file
// holds the checker to what it must catch, on the same reference CVs, keyless.

const ref = (id: string) => REFERENCE_CVS.find((r) => r.id === id)!.doc;
const failed = (doc: Parameters<typeof checkRoundTrip>[0], text: string): RoundTripCheck[] =>
  ROUND_TRIP_CHECKS.filter((c) => !checkRoundTrip(doc, text).checks[c]);

test("the reference set is the standard's: short, long, career change, diacritics, two pages", () => {
  assert.deepEqual(
    REFERENCE_CVS.map((r) => r.id),
    ["short", "long", "career-change", "czech", "two-pages"]
  );
});

test("the sheet's own reading passes every check, for every reference CV", () => {
  for (const { id, doc } of REFERENCE_CVS) {
    const result = checkRoundTrip(doc, cvReadingLines(doc).join("\n"));
    assert.equal(result.pass, true, `${id}: ${JSON.stringify(result.findings)}`);
  }
});

test("the reading opens with the name, and sets each entry as title — employer, dates", () => {
  const lines = cvReadingLines(ref("short"));
  assert.equal(lines[0], "Alex Morgan");
  assert.ok(lines.includes("Frontend Developer — Brightline Studio  09/2024 – present"));
  assert.ok(lines.includes("- Wrote the component tests the team now runs on every pull request."));
  // A compacted role is its one line, no bullets under it.
  const long = cvReadingLines(ref("long"));
  const junior = long.indexOf("Junior Developer — Ashford Media  07/2010 – 08/2011");
  assert.ok(junior > 0 && !long[junior + 1]!.startsWith("- "));
});

test("a sidebar read positionally: the name late, a bullet spliced by the side column", () => {
  const doc = ref("short");
  const lines = cvReadingLines(doc);
  // A left column's lines interleaved with the main flow, as a y-then-x reader returns them.
  const spliced = ["Skills", "TypeScript, React, CSS", ...lines];
  const i = spliced.findIndex((l) => l.startsWith("- Cut the main bundle"));
  spliced[i] = "Languages - Cut the main bundle from 1.9 MB to 740 kB by splitting";
  spliced.splice(i + 1, 0, "English (native) routes and removing an unused charting library.");
  const f = failed(doc, spliced.join("\n"));
  assert.ok(f.includes("nameFirst"), f.join());
  assert.ok(f.includes("bulletsWhole"), f.join());
});

test("dates hung apart from their title fail entries-together", () => {
  const doc = ref("short");
  const text = cvReadingLines(doc)
    .join("\n")
    .replace("Frontend Developer — Brightline Studio  09/2024 – present", "09/2024 – present\nSkills\nFrontend Developer — Brightline Studio");
  assert.ok(failed(doc, text).includes("entriesTogether"));
});

test("stripped diacritics, a lost heading, a hidden word and a glued date are all caught", () => {
  const doc = ref("czech");
  const good = cvReadingLines(doc).join("\n");
  assert.deepEqual(failed(doc, good.replace("Žďárské strojírny", "Zdarske strojirny")), ["entriesTogether", "nothingMissing", "diacritics", "nothingForeign"]);
  // Letter-spaced heading: extractors return it as separate letters.
  assert.ok(failed(doc, good.replace("Pracovní zkušenosti", "P R A C O V N Í  Z K U Š E N O S T I")).includes("nothingMissing"));
  // A level word no one sees, or a template placeholder, is text the model does not hold.
  assert.ok(failed(doc, `${good}\n(expert) Lorem ipsum`).includes("nothingForeign"));
  // pypdf glued a title onto its dates: "Hlavní účetní03/2020".
  assert.ok(failed(doc, good.replace("Hlavní účetní — ", "Hlavní účetní03/2020 — ")).includes("nothingForeign"));
});

test("a bullet read twice, or a replacement character, is a finding", () => {
  const doc = ref("short");
  const lines = cvReadingLines(doc);
  const twice = [...lines, lines.find((l) => l.startsWith("- Built the booking flow"))!].join("\n");
  assert.ok(failed(doc, twice).includes("bulletsWhole"));
  assert.ok(failed(ref("czech"), cvReadingLines(ref("czech")).join("\n").replace("Brno", "Brno �")).includes("diacritics"));
});

test("the running head repeating the name on page two is not a finding", () => {
  const doc = ref("two-pages");
  const lines = cvReadingLines(doc);
  const paged = [...lines.slice(0, 30), doc.name, ...lines.slice(30)].join("\n");
  assert.equal(checkRoundTrip(doc, paged).pass, true);
});
