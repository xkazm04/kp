// GET /api/decisions/jd-freshness — a store throw must answer a code. jdLastEditedAt
// opens SQLite; without a catch a locked DB became Next's framework 500 with an
// unreadable body, on the route the staleness chips depend on. Source contract
// plus a stubbed throw.
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
const REAL_JOBS = new URL("../../../_lib/db/jobs.ts", import.meta.url).href;
const STUB_URL =
  "data:text/javascript," +
  encodeURIComponent(
    `export * from ${JSON.stringify(REAL_JOBS)};\n` +
      `export function jdLastEditedAt() { throw new Error(${JSON.stringify(THROW_MSG)}); }\n`
  );

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/app/_lib/db/jobs") return { url: STUB_URL, shortCircuit: true };
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

test("the 500 catch answers through safeJsonError, never a framework 500", () => {
  assert.match(src, /safeJsonError\(error, "api:decisions\/jd-freshness", "JD_FRESHNESS_LOOKUP_FAILED"\)/);
});

test("a stubbed store throw answers JD_FRESHNESS_LOOKUP_FAILED and hides the thrown message", async () => {
  const res = await GET(new Request("http://localhost/api/decisions/jd-freshness?jobs=jd-foo"));
  assert.equal(res.status, 500);
  const body = (await res.json()) as { error?: unknown; code?: unknown };
  assert.equal(body.code, "JD_FRESHNESS_LOOKUP_FAILED");
  assert.equal(typeof body.error, "string");
  const blob = JSON.stringify(body);
  assert.equal(blob.includes(THROW_MSG), false, "the thrown SQLITE/path message must not reach the client");
  assert.doesNotMatch(blob, /SQLITE/i);
  assert.doesNotMatch(blob, /kp\.sqlite/);
  assert.ok(
    logged.some((args) => args.some((a) => typeof a === "string" && a.includes("JD_FRESHNESS_LOOKUP_FAILED"))),
    "the raw fault must be logged server-side"
  );
});
