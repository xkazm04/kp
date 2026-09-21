// The brief edit form and title chip must show catalog seniority labels, not
// the raw junior|medior|senior|lead slugs. Source-level: the components need
// React + next-intl to run. Runner: npm run test:unit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const editSrc = readFileSync(path.join(here, "JdsIntakeBriefEdit.tsx"), "utf8").replace(/\r\n/g, "\n");
const titleSrc = readFileSync(path.join(here, "JdsIntakeBriefTitle.tsx"), "utf8").replace(/\r\n/g, "\n");

const SENIORITIES = ["junior", "medior", "senior", "lead"] as const;

test("brief-edit seniority options are catalog labels, not the raw slugs", () => {
  assert.match(editSrc, /useEnumLabel\(\)/);
  assert.match(editSrc, /enumLabel\("seniority", s\)/);
  assert.doesNotMatch(
    editSrc,
    /<option key=\{s\} value=\{s\}>\s*\{s\}\s*<\/option>/,
    "option text must not be the slug",
  );
  // The option VALUE stays the wire slug so a save still posts junior|medior|…
  assert.match(editSrc, /<option key=\{s\} value=\{s\}>/);
});

test("the title-row seniority chip uses the same catalog labels", () => {
  assert.match(titleSrc, /useEnumLabel\(\)/);
  assert.match(titleSrc, /enumLabel\("seniority", brief\.seniority\)/);
  assert.doesNotMatch(titleSrc, /CHIP_QUIET\}>\{brief\.seniority\}/);
});

test("four seniority slugs have distinct catalog labels when the catalog is present", () => {
  const root = path.join(here, "..", "..", "..", "..", "..");
  const en = JSON.parse(readFileSync(path.join(root, "messages", "en.json"), "utf8")) as {
    enums: { seniority: Record<string, string> };
  };
  const cs = JSON.parse(readFileSync(path.join(root, "messages", "cs.json"), "utf8")) as {
    enums: { seniority: Record<string, string> };
  };
  for (const s of SENIORITIES) {
    assert.ok(en.enums.seniority[s], `en catalog missing enums.seniority.${s}`);
    assert.notEqual(cs.enums.seniority[s], s, `cs catalog still shows the raw slug for ${s}`);
  }
  assert.equal(SENIORITIES.length, 4);
});
