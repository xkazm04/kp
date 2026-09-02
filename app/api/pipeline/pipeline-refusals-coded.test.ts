// The board's hottest refusal paths must answer a CODE, never English prose
// (docs/architecture/api-contracts.md §1.1). This is the half no runtime test
// catches: a later edit can hand-roll `NextResponse.json({ error: "…" })` back
// into any of these files and every locale silently goes back to reading English.
//
// Why these four files specifically: /api/pipeline/[id] is the per-card surface,
// pipeline-entry-action.ts is the shared move/decide helper BOTH it and the batch
// route answer from, the batch route copies that helper's refusal onto each per-id
// row, and stage-migration is the step editor's. The batch rows in particular were
// painted VERBATIM by the bulk action bar, so they were the largest English leak on
// a Czech, German or French board.
//
// Source-guard style (mirrors authz-parity.test.ts / rate-limit-contract.test.ts):
// these modules import through the "@/…" alias and pull in next/server, so the
// contract is pinned structurally against the source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(HERE, rel), "utf8").replace(/\r\n/g, "\n");

/** Every code the registry declares as a REFUSAL, read as source (api-response.ts
 *  imports next/server, which the bare unit runner does not resolve). */
function refusalCodes(): Set<string> {
  const src = read("../../_lib/api-response.ts");
  const block = src.slice(src.indexOf("export const REFUSAL_ERRORS"), src.indexOf("export type RefusalErrorCode"));
  const codes = new Set<string>();
  for (const m of block.matchAll(/^\s{2}([A-Z][A-Z0-9_]*):/gm)) codes.add(m[1]!);
  assert.ok(codes.size > 20, "the refusal registry should have been found");
  return codes;
}

// A hand-rolled English refusal envelope. Deliberately narrow: it matches a STRING
// LITERAL body, which is what a prose refusal looks like, and not a variable.
const RAW_REFUSAL = /NextResponse\.json\(\s*\{\s*error:\s*[`"']/;

for (const rel of ["./[id]/route.ts", "./batch/route.ts", "./stage-migration/route.ts", "./outcomes/route.ts"]) {
  test(`${rel} answers refusals with a code, never a hand-written English body`, () => {
    const src = read(rel);
    assert.doesNotMatch(src, RAW_REFUSAL, "a refusal must go through jsonRefusal (or carry REFUSAL_ERRORS + its code)");
  });
}

test("the shared entry action answers every refusal with a registered REFUSAL code", () => {
  const src = read("../../_lib/pipeline-entry-action.ts");
  const known = refusalCodes();

  // The helper's single refusal chokepoint takes a CODE, not a message.
  assert.match(
    src,
    /const err = \(status: number, code: RefusalErrorCode/,
    "err() must take a refusal CODE — a message parameter is how prose gets back in"
  );

  const calls = [...src.matchAll(/\berr\(\s*(\d{3}),\s*("?)([A-Za-z_]+)\2/g)];
  assert.ok(calls.length >= 8, `expected the helper's refusals to be found, saw ${calls.length}`);
  for (const [, status, quoted, code] of calls) {
    assert.equal(quoted, '"', `err(${status}, …) must pass a code literal, not an expression`);
    assert.ok(known.has(code!), `err(${status}, "${code}") is not a code REFUSAL_ERRORS declares`);
  }
  // …and none of the English it used to inline survives.
  for (const gone of ["Pipeline entry not found.", "Unknown action.", "Unknown stage", "refresh and decide again"]) {
    assert.ok(!src.includes(gone), `the prose refusal "${gone}" must be gone from the helper`);
  }
});

test("the batch route carries the helper's CODE onto each per-id row", () => {
  const src = read("./batch/route.ts");
  assert.match(src, /type BatchOutcome = \{[^}]*code\?: string/, "a per-id row must be able to carry a code");
  assert.match(src, /const code = typeof r\.body\.code === "string" \? r\.body\.code : undefined;/, "the helper's code must ride through");
  assert.match(src, /REFUSAL_ERRORS\.PIPELINE_BATCH_ITEM_MALFORMED/, "the batch's OWN refusals are coded too");
  assert.match(src, /REFUSAL_ERRORS\.PIPELINE_BATCH_ITEM_FAILED/);
});

test("the bulk action bar resolves those codes instead of painting the server's string", () => {
  const hook = read("../../features/hiring/pipeline/usePipelineBulk.ts");
  assert.match(hook, /reasonCodes/, "the hook must keep the CODES");
  assert.ok(!/reasons\.add\(r\.reason\)/.test(hook), "keeping the server's prose is the bug this closes");
  assert.match(hook, /if \(r\.code\) reasonCodes\.add\(r\.code\)/);

  const bar = read("../../features/hiring/pipeline/PipelineBulkActionBar.tsx");
  assert.match(bar, /useErrorMessage/, "the bar resolves errors.<CODE> in the reader's language");
  assert.match(bar, /reasonCodes\?\.length/, "…and renders the resolved codes");
});

test("STAGE_MIGRATION_FAILED no longer claims nothing was saved", () => {
  // The route moves candidates FIRST and writes the axis SECOND (deliberately), so a
  // failure genuinely can land with people already moved. "Nothing was saved" told
  // the operator the opposite of what the ordering guarantees.
  const registry = read("../../_lib/api-response.ts");
  const line = registry.split("\n").find((l) => l.includes("STAGE_MIGRATION_FAILED:"));
  assert.ok(line, "the code must still exist");
  assert.ok(!/Nothing was saved/i.test(line!), "the message must not deny a partial state the ordering allows");
  assert.match(line!, /may already have been moved/i, "…it must name it");
});
