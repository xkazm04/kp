// The organization backup pair answered in English prose, and the restore door read an
// UNBOUNDED body.
//
// The body first, because it is the one an operator could not have worked around:
// `request.json()` parses the whole upload into the Node heap before anything looks at
// it, so an authorized administrator — or a script holding their session — could stream
// gigabytes in and take down the server every other route shares. A restore button that
// can OOM the process is a self-inflicted outage, not a feature.
//
// And the prose: "Refusing to load — these tables already contain rows: …" was what a
// Czech administrator read while deciding whether to overwrite their whole company, and
// the 500 path forwarded better-sqlite3's own message (SQLITE_* codes, the absolute db
// path) straight onto the wire. Both routes now answer CODES; the engine's decisions
// carry theirs on a PortabilityError.
//
// A source scan, like export-guard.test.ts and error-response-contract.test.ts beside it:
// a route handler needs a request scope the unit runner cannot give it, and "the body is
// bounded" / "the catch does not forward .message" are properties the source states.
//
// RED FIRST: before this change the import route called `request.json()` with no cap and
// both catches ended in `NextResponse.json({ error: message }, { status: 500 })`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "../../../..");
const read = (rel: string) => readFileSync(path.join(appRoot, rel), "utf-8");

const importSrc = read("app/api/workspace/import/route.ts");
const exportSrc = read("app/api/workspace/export/route.ts");
const apiResponseSrc = read("app/_lib/api-response.ts");
const portabilitySrc = read("app/_lib/db-portability.ts");

test("the restore door reads a BOUNDED body, never request.json()", () => {
  assert.doesNotMatch(
    importSrc,
    /await request\.json\(\)/,
    "request.json() has no budget — the whole upload lands in the heap before it is judged",
  );
  const capAt = importSrc.search(/const MAX_IMPORT_BODY_BYTES = /);
  assert.ok(capAt > 0, "the cap is a named constant, so the number is reviewable");
  assert.match(importSrc, /MAX_IMPORT_BODY_BYTES = 32 \* 1024 \* 1024/, "32 MB — stated, not implied");
  // content-length is advisory; the real cap counts bytes read off the wire.
  assert.match(importSrc, /request\.headers\.get\("content-length"\)/, "an advisory fast-reject first");
  assert.match(
    importSrc,
    /readTextWithLimit\(request, MAX_IMPORT_BODY_BYTES\)/,
    "and the enforcing read, bounded by the same constant",
  );
  // Both arms answer the same code, and the limit rides along as data.
  const overLimit = importSrc.match(/jsonRefusal\("IMPORT_BODY_TOO_LARGE", 413, \{ maxBytes: MAX_IMPORT_BODY_BYTES \}\)/g);
  assert.equal(overLimit?.length, 2, "the declared-length and the read-length refusals must agree");
});

test("both handlers answer codes, and neither forwards a thrown message", () => {
  for (const [name, src] of [
    ["import", importSrc],
    ["export", exportSrc],
  ] as const) {
    assert.doesNotMatch(
      src,
      /error instanceof Error \? error\.message/,
      `${name}: a store fault's own message carries SQLITE_* codes and the db path`,
    );
    assert.match(src, /if \(error instanceof PortabilityError\) return jsonRefusal\(error\.code, error\.status\)/,
      `${name}: an engine DECISION is answered as the refusal it is`);
  }
  assert.match(importSrc, /safeJsonError\(error, "api:workspace\/import", "WORKSPACE_RESTORE_FAILED"\)/);
  assert.match(exportSrc, /safeJsonError\(error, "api:workspace\/export", "WORKSPACE_EXPORT_FAILED"\)/);
});

test("the request-shape refusals are coded, not prose", () => {
  assert.match(importSrc, /jsonRefusal\("IMPORT_DUMP_REQUIRED", 400\)/, "an absent dump");
  assert.match(
    importSrc,
    /jsonRefusal\("IMPORT_DUMP_MALFORMED", 400, \{ detail: coerced\.reason \}\)/,
    "a malformed dump — the validator's English reason rides as DATA for the console, " +
      "it is not the sentence the surface paints",
  );
  assert.doesNotMatch(
    importSrc,
    /NextResponse\.json\(\{ error: coerced\.reason \}/,
    "the validator's prose must not be the client's message",
  );
});

test("every code the portability engine can throw exists in REFUSAL_ERRORS", () => {
  // PortabilityErrorCode is the closed vocabulary; REFUSAL_ERRORS is where its messages
  // live, and npm run i18n:check pins every REFUSAL_ERRORS key to all four catalogs — so
  // this one assertion is what makes "the engine speaks the reader's language" true.
  const union = portabilitySrc.match(/export type PortabilityErrorCode =([\s\S]*?);/);
  assert.ok(union, "PortabilityErrorCode must be declared as a literal union");
  const codes = [...union[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
  assert.ok(codes.length >= 5, `expected the whole vocabulary, got ${codes.join(", ")}`);
  for (const code of codes) {
    assert.match(
      apiResponseSrc,
      new RegExp(`^  ${code}:`, "m"),
      `${code} has no REFUSAL_ERRORS entry, so the client cannot resolve errors.${code}`,
    );
  }
  // …and nothing in the engine throws a bare Error any more: a plain throw is a message
  // with no code, which is exactly the state this change closed.
  assert.doesNotMatch(portabilitySrc, /throw new Error\(/, "every refusal carries a code");
});
