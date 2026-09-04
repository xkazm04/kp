// The recruiter agenda READ is bounded, says so, and is throttled.
//
// `GET /api/schedule` served `listScheduleInvites(200, ws)` — a hard-coded page with
// no cursor, no way to ask for more and, worse, no signal that there was more. It is
// the single list TWO live surfaces hydrate from (the Schedule tab's grid and the
// invite lifecycle panel), so a team past 200 live invites silently lost the oldest
// of them from the agenda, from the lifecycle buckets AND from the grid's booked
// markers — an hour that WAS taken stopped being drawn as taken, which is the one
// thing the shared slot pool exists to prevent. It also carried no limiter at all
// while both write verbs on the same route did.
//
// This drives the REAL handler on a throwaway SQLite file and pins the three
// properties: the clamp, the truthful `truncated` claim, and the throttle.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";

// Point next/server at the shared test shim BEFORE the route loads (hooks only affect
// later resolutions — hence the dynamic imports below).
register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// `next/headers` cannot run outside a Next request scope; the route only needs a jar
// that does not throw, so the workspace resolves to the default one.
const VIRTUAL_HEADERS = "kp-test:next-headers";
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") return { url: VIRTUAL_HEADERS, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === VIRTUAL_HEADERS) {
      return {
        format: "module",
        shortCircuit: true,
        source: `
          export async function cookies() { return { get: () => undefined }; }
          export async function headers() { return new Headers(); }
          export async function draftMode() { return { isEnabled: false }; }
        `,
      };
    }
    return nextLoad(url, context);
  },
});

const { GET } = await import("./route.ts");
const { createScheduleInvite } = await import("../../_lib/schedule-store.ts");
// Slice, never the `./db` barrel (test:perf ratchets barrel importers). Importing it
// also brings up the pipeline_entries table the agenda read left-joins.
const { createPipelineEntry } = await import("../../_lib/db/pipeline.ts");

after(() => cleanupUnitDb());

// A fresh client IP per call: the per-IP budget is shared process state, so a test
// about the CLAMP must never fail on a 429 it provoked itself.
let ipSeq = 1;
const get = (query = ""): Request =>
  new Request(`http://localhost/api/schedule${query}`, {
    headers: { "x-forwarded-for": `10.9.0.${ipSeq++}` },
  });

type ListBody = { invites: { token: string }[]; limit: number; truncated: boolean; interviewTz: string };

for (let i = 0; i < 3; i++) {
  const entry = createPipelineEntry({
    candidateId: `bounds-c${i}`,
    candidateLabel: `Bounds Candidate ${i}`,
    jobId: `bounds-job-${i}`,
    jobTitle: "Bounds Role",
  }).entry;
  createScheduleInvite({ entryId: entry.id, candidateLabel: entry.candidateLabel, jobTitle: entry.jobTitle });
}

test("a read that hit its bound SAYS so, instead of presenting a clipped agenda as whole", async () => {
  const res = await GET(get("?limit=2"));
  assert.equal(res.status, 200);
  const body = (await res.json()) as ListBody;
  assert.equal(body.invites.length, 2, "the page is the size that was asked for");
  assert.equal(body.limit, 2, "…and the answer states the bound it applied");
  assert.equal(body.truncated, true, "there IS more — a surface that renders this as the whole agenda is lying");
});

test("a read inside its bound is not marked truncated", async () => {
  const res = await GET(get("?limit=50"));
  const body = (await res.json()) as ListBody;
  assert.equal(body.truncated, false, "three rows under a bound of fifty is a complete answer");
  assert.equal(body.limit, 50);
});

test("the limit is CLAMPED, never trusted", async () => {
  // Junk, zero and negative all fold to the default rather than to NaN/0 rows.
  for (const q of ["", "?limit=abc", "?limit=0", "?limit=-5", "?limit=1e999"]) {
    const body = (await (await GET(get(q))).json()) as ListBody;
    assert.equal(body.limit, 200, `"${q}" must fold to the default page, got ${body.limit}`);
  }
  // …and an absurd ask is capped at the ceiling, so one caller cannot make the server
  // walk the whole table.
  const huge = (await (await GET(get("?limit=999999"))).json()) as ListBody;
  assert.equal(huge.limit, 1000, "the ceiling is the real bound");
  const fractional = (await (await GET(get("?limit=7.9"))).json()) as ListBody;
  assert.equal(fractional.limit, 7, "a fractional ask truncates to a whole page size");
});

// The THROTTLE is pinned where every other limited door's is - the named spec for
// ./schedule/route.ts in app/api/rate-limit-contract.test.ts, which asserts the call
// site, the budget line and the chokepoint refusal in the source AND drives the real
// in-process limiter with the same config. It is deliberately not re-driven through
// the handler here: clientIpFrom folds every caller in a test process onto one key,
// so a behavioural 429 case in this file would spend the budget the CLAMP cases above
// need and turn a bound test into a throttle test.
