import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// The interview note tells the candidate where to ask for erasure. The only
// link every candidate message carries is the GDPR footer (dataFooter), so the
// note must name that footer's own label, word for word, in every locale.

const LOCALES = ["en", "cs", "de", "fr"] as const;

function findKey(node: unknown, key: string): string | undefined {
  if (node === null || typeof node !== "object") return undefined;
  const obj = node as Record<string, unknown>;
  if (typeof obj[key] === "string") return obj[key] as string;
  for (const child of Object.values(obj)) {
    const hit = findKey(child, key);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

// "Your data: review ..." -> "Your data"
function footerLabel(footer: string): string {
  const body = footer.replace(/^[·\s]+/, "");
  const label = body.split(":")[0].trim();
  assert.ok(label.length > 0, "dataFooter has no label before the colon");
  return label;
}

for (const locale of LOCALES) {
  test(`interviewData names the dataFooter label (${locale})`, () => {
    const catalog = JSON.parse(
      readFileSync(join(process.cwd(), "messages", `${locale}.json`), "utf8"),
    );
    const footer = findKey(catalog, "dataFooter");
    const note = findKey(catalog, "interviewData");
    assert.ok(footer, "dataFooter missing");
    assert.ok(note, "interviewData missing");
    const label = footerLabel(footer);
    assert.ok(
      note.includes(label),
      `interviewData must contain the footer label "${label}"`,
    );
  });
}
