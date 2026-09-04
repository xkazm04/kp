// The client mirror of the analytics payload must not drift from the server type.
//
// WHY THIS EXISTS. `AnalyticsTypes.Analytics` is a HAND-WRITTEN mirror of
// `db/analytics.ts`'s `PipelineAnalytics` (the client cannot import the server type
// at runtime — that module opens better-sqlite3 — so it re-declares the shape and
// the route's JSON is cast onto it). Nothing compared the two. Three fields the
// server computes on every request had no declaration here at all
// (`timeToHireSamples`, `costPerHireAsOf`, `hiresClosedInWindow`), and the Economics
// surface had to intersect its own optional copy of two of them onto `Analytics`
// just to read them without a cast — with a comment asking a later change to delete
// it. A mirror nobody checks is how a field becomes invisible to every consumer that
// reads the declared type instead of the wire.
//
// A source-level test on purpose: this is a fact about two type DECLARATIONS, which
// no runtime value can observe (the cast erases at compile time).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

/** Top-level property names of an object type alias, by brace matching. */
function members(source: string, alias: string): string[] {
  const start = source.indexOf(`export type ${alias} = {`);
  assert.notEqual(start, -1, `${alias} must still be an object type alias`);
  const open = source.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  assert.notEqual(end, -1, `${alias} has an unbalanced body`);
  return source
    .slice(open + 1, end)
    .split("\n")
    // Two-space indent = a top-level member; deeper lines belong to a nested shape.
    .filter((line) => /^ {2}[a-zA-Z_]/.test(line))
    .map((line) => line.trim().replace(/^([a-zA-Z_]+)\??.*$/, "$1"));
}

/** The one field the ROUTE adds on top of the server type (`{ ...current, deltas }`
 *  in app/api/analytics/route.ts), so the mirror legitimately carries it. */
const ROUTE_ADDED = ["deltas"];

test("every field the server computes is declared in the client mirror", () => {
  const server = members(read("app", "_lib", "db", "analytics.ts"), "PipelineAnalytics");
  const client = members(read("app", "features", "insights", "analytics", "AnalyticsTypes.ts"), "Analytics");
  assert.ok(server.length > 25, "the parse must actually have found the server type");
  const missing = server.filter((f) => !client.includes(f));
  assert.deepEqual(missing, [], `AnalyticsTypes.Analytics is missing server fields: ${missing.join(", ")}`);
});

test("the mirror invents nothing the route does not send", () => {
  const server = members(read("app", "_lib", "db", "analytics.ts"), "PipelineAnalytics");
  const client = members(read("app", "features", "insights", "analytics", "AnalyticsTypes.ts"), "Analytics");
  const extra = client.filter((f) => !server.includes(f) && !ROUTE_ADDED.includes(f));
  assert.deepEqual(extra, [], `declared client-side but never sent: ${extra.join(", ")}`);
});

test("the Economics surface no longer intersects its own copy of the payload", () => {
  const economics = read("app", "features", "insights", "analytics", "sections", "economicsTypes.ts");
  assert.doesNotMatch(
    economics,
    /EconomicsAnalytics\s*=\s*Analytics\s*&/,
    "the two fields it patched on are in the mirror now — a second, optional declaration of a field the server always sends is how a consumer learns to treat it as maybe-absent"
  );
});
