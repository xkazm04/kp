// GET /api/decisions/records — a store throw must answer a code, never the
// thrown message. verify + listPipeline sit on better-sqlite3, so `.message`
// carries SQLITE_* text and the absolute db path; jsonError used to forward
// that onto the sealed Art. 22 dossier. Source contract plus a stubbed throw.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";

after(() => cleanupUnitDb());

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(HERE, "route.ts"), "utf8").replace(/\r\n/g, "\n");

const THROW_MSG = "SQLITE_BUSY /tmp/kp.sqlite leaked-path";
const REAL_STORE = new URL("../../../_lib/decision-record-store.ts", import.meta.url).href;
const STUB_URL =
  "data:text/javascript," +
  encodeURIComponent(
    `export * from ${JSON.stringify(REAL_STORE)};\n` +
      `export function listDecisionRecords() { throw new Error(${JSON.stringify(THROW_MSG)}); }\n`
  );

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/app/_lib/decision-record-store") return { url: STUB_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

type Route = { GET: (request: Request) => Promise<Response> };
let GET: Route["GET"];
const logged: unknown[][] = [];
const realError = console.error;

before(async () => {
  ({ GET } = (await import("./route.ts")) as Route);
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
});
after(() => {
  console.error = realError;
});

test("the 500 catch answers through safeJsonError, never error.message", () => {
  assert.match(src, /safeJsonError\(error, "api:decisions\/records", "DECISION_RECORDS_READ_FAILED"\)/);
  assert.doesNotMatch(src, /jsonError\(error/);
  assert.doesNotMatch(src, /Failed to load decision records/);
});

test("a stubbed store throw answers DECISION_RECORDS_READ_FAILED and hides the thrown message", async () => {
  const res = await GET(new Request("http://localhost/api/decisions/records"));
  assert.equal(res.status, 500);
  const body = (await res.json()) as { error?: unknown; code?: unknown };
  assert.equal(body.code, "DECISION_RECORDS_READ_FAILED");
  assert.equal(typeof body.error, "string");
  const blob = JSON.stringify(body);
  assert.equal(blob.includes(THROW_MSG), false, "the thrown SQLITE/path message must not reach the client");
  assert.doesNotMatch(blob, /SQLITE/i);
  assert.doesNotMatch(blob, /kp\.sqlite/);
  assert.ok(
    logged.some((args) => args.some((a) => typeof a === "string" && a.includes("DECISION_RECORDS_READ_FAILED"))),
    "the raw fault must be logged server-side"
  );
});
