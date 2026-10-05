import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  collectDecisionTrail,
  decisionCsvRows,
  decisionLogUrl,
  TRAIL_FETCH_LIMIT,
  type DecisionCsvLabels,
  type DecisionCsvRender,
  type DecisionCsvScope,
} from "./decisionLogCsv";
import type { Decision, DecisionPage } from "./analyticsDecisionLogTypes";

// The decision log's export is an AUDIT artifact: two surfaces offer it (the
// Analytics table, the Decisions tab header) and a regulator may receive it. What
// these tests pin is therefore the file's shape and its honesty — the provenance
// block, the two time columns, the empty cell for an absent join, and the fact
// that a truncated paging run is reported rather than presented as complete.

const LABELS: DecisionCsvLabels = {
  title: "Decision log",
  provExport: "Export",
  provGenerated: "Generated",
  provZone: "Time zone",
  provLocale: "Language",
  provScope: "Scope",
  provFilters: "Filters",
  timeLocal: "When (Europe/Prague)",
  timeIso: "When (UTC)",
  attribution: "By",
  actor: "Actor",
  kind: "Decision",
  candidate: "Candidate",
  role: "Role",
  cohort: "Cohort",
  detail: "Detail",
};

const RENDER: DecisionCsvRender = {
  time: (iso) => `rendered:${iso}`,
  attribution: (bucket) => `bucket:${bucket}`,
  actor: (actor) => actor ?? "not identified",
  kind: (kind) => `kind:${kind}`,
  cohort: (cohort) => `cohort:${cohort.compared}`,
  detail: (d) => d.detail,
};

const SCOPE: DecisionCsvScope = {
  generatedAt: "21.09.2026 08:00",
  zone: "Europe/Prague",
  locale: "cs",
  scope: "Whole trail · 2 of 2 rows",
  filters: "No filters",
};

function decision(over: Partial<Decision> = {}): Decision {
  return {
    id: 1,
    entryId: "entry-1",
    candidateLabel: "Šárka Nováková",
    jobTitle: "Backend Engineer",
    // An auto kind, so the attribution bucket is a real lookup rather than "unknown".
    kind: "auto_rejected",
    fromStage: null,
    toStage: null,
    detail: "below floor",
    createdAt: "2026-09-20T09:30:00.000Z",
    actor: "auto:screen-wave",
    ...over,
  };
}

test("the file leads with its provenance block, then a blank separator, then the header", () => {
  const rows = decisionCsvRows([], LABELS, RENDER, SCOPE);
  assert.deepEqual(rows.slice(0, 6), [
    ["Export", "Decision log"],
    ["Generated", "21.09.2026 08:00"],
    ["Time zone", "Europe/Prague"],
    ["Language", "cs"],
    ["Scope", "Whole trail · 2 of 2 rows"],
    ["Filters", "No filters"],
  ]);
  // The blank row is what stops a spreadsheet import from reading the block as data.
  assert.deepEqual(rows[6], []);
  assert.equal(rows[7]?.[0], "When (Europe/Prague)");
  // An empty trail is a header and nothing under it — the scope line above says so.
  assert.equal(rows.length, 8);
});

test("every row carries the rendered time AND the ISO instant, in that order", () => {
  const rows = decisionCsvRows([decision()], LABELS, RENDER, SCOPE);
  const [when, iso] = rows[8] as string[];
  assert.equal(when, "rendered:2026-09-20T09:30:00.000Z");
  // UAT LUC-ANA-7 — the unambiguous machine value stays beside the zone-bound one.
  assert.equal(iso, "2026-09-20T09:30:00.000Z");
});

test("columns follow the header, and a decision with no cohort writes an empty cell", () => {
  const rows = decisionCsvRows([decision()], LABELS, RENDER, SCOPE);
  const header = rows[7] as string[];
  const body = rows[8] as (string | null)[];
  assert.equal(header.length, body.length);
  assert.equal(body[header.indexOf("By")], "bucket:auto");
  assert.equal(body[header.indexOf("Actor")], "auto:screen-wave");
  assert.equal(body[header.indexOf("Decision")], "kind:auto_rejected");
  assert.equal(body[header.indexOf("Candidate")], "Šárka Nováková");
  assert.equal(body[header.indexOf("Role")], "Backend Engineer");
  // Never guessed: a row the joins could not back shows nothing.
  assert.equal(body[header.indexOf("Cohort")], null);
  assert.equal(body[header.indexOf("Detail")], "below floor");
});

test("a cohort join is rendered when present", () => {
  const rows = decisionCsvRows(
    [decision({ cohort: { source: "selection", compared: 7, field: 12 } })],
    LABELS,
    RENDER,
    SCOPE
  );
  const body = rows[8] as (string | null)[];
  assert.equal(body[(rows[7] as string[]).indexOf("Cohort")], "cohort:7");
});

test("an unmapped kind is attributed UNKNOWN, never auto", () => {
  const rows = decisionCsvRows([decision({ kind: "kind_that_does_not_exist" })], LABELS, RENDER, SCOPE);
  const body = rows[8] as (string | null)[];
  assert.equal(body[(rows[7] as string[]).indexOf("By")], "bucket:unknown");
});

// --- the URL the export and the table must share ------------------------------

test("the query carries paging, ordering and locale, and omits absent filters", () => {
  const url = decisionLogUrl({ offset: 40, limit: 50, sort: "createdAt", dir: "desc", locale: "cs" });
  const params = new URL(url, "https://kp.local").searchParams;
  assert.equal(params.get("offset"), "40");
  assert.equal(params.get("limit"), "50");
  assert.equal(params.get("sort"), "createdAt");
  assert.equal(params.get("dir"), "desc");
  assert.equal(params.get("locale"), "cs");
  assert.equal(params.get("kind"), null);
  assert.equal(params.get("attribution"), null);
  assert.equal(params.get("q"), null);
});

test("kind and attribution are sent TOGETHER — the route intersects them (LUC-ANA-12)", () => {
  const url = decisionLogUrl({
    offset: 0,
    limit: 20,
    sort: "candidateLabel",
    dir: "asc",
    locale: "en",
    kind: "auto_rejected",
    attribution: "human",
    q: "cermak",
  });
  const params = new URL(url, "https://kp.local").searchParams;
  assert.equal(params.get("kind"), "auto_rejected");
  assert.equal(params.get("attribution"), "human");
  assert.equal(params.get("q"), "cermak");
});

// --- the paging loop ----------------------------------------------------------

function page(over: Partial<DecisionPage> & { decisions: Decision[] }): DecisionPage {
  return { total: 0, hasMore: false, nextOffset: 0, ...over };
}

test("the loop follows nextOffset to the end and reports the server's total", async () => {
  const seen: [number, number][] = [];
  const pages: DecisionPage[] = [
    page({ decisions: [decision({ id: 1 })], total: 3, hasMore: true, nextOffset: 1 }),
    page({ decisions: [decision({ id: 2 })], total: 3, hasMore: true, nextOffset: 2 }),
    page({ decisions: [decision({ id: 3 })], total: 3, hasMore: false, nextOffset: 3 }),
  ];
  const result = await collectDecisionTrail(async (offset, limit) => {
    seen.push([offset, limit]);
    return pages[seen.length - 1];
  });
  // Offsets come from the SERVER's nextOffset, never recomputed on the client.
  assert.deepEqual(seen, [
    [0, TRAIL_FETCH_LIMIT],
    [1, TRAIL_FETCH_LIMIT],
    [2, TRAIL_FETCH_LIMIT],
  ]);
  assert.deepEqual(result.rows.map((r) => r.id), [1, 2, 3]);
  assert.equal(result.total, 3);
  assert.equal(result.complete, true);
});

test("an empty page stops the loop even when the route still claims hasMore", async () => {
  let calls = 0;
  const result = await collectDecisionTrail(async () => {
    calls++;
    return page({ decisions: [], total: 9, hasMore: true, nextOffset: 0 });
  });
  assert.equal(calls, 1);
  assert.equal(result.rows.length, 0);
  assert.equal(result.complete, true);
});

test("hitting the page ceiling is reported as INCOMPLETE, so the file cannot claim the whole trail", async () => {
  let calls = 0;
  const result = await collectDecisionTrail(
    async (offset) => {
      calls++;
      return page({ decisions: [decision({ id: offset + 1 })], total: 100, hasMore: true, nextOffset: offset + 1 });
    },
    { maxPages: 3, limit: 1 }
  );
  assert.equal(calls, 3);
  assert.equal(result.rows.length, 3);
  assert.equal(result.total, 100);
  // The one assertion this file exists for: a run that stopped early says so.
  assert.equal(result.complete, false);
});

test("a failing read propagates — no partial file may be named 'whole trail'", async () => {
  await assert.rejects(
    collectDecisionTrail(async (offset) => {
      if (offset > 0) throw new Error("read fell over");
      return page({ decisions: [decision()], total: 5, hasMore: true, nextOffset: 1 });
    }),
    /read fell over/
  );
});

test("the Decisions header and the Analytics table produce the same bytes for the same rows and scope", async () => {
  // The two surfaces differ only in who supplies the query: the table builds it from
  // its sort/filter state, the header from fixed arguments. With the table's defaults
  // (newest first, no narrowing) those are the SAME url, so the same pages come back…
  const table = (offset: number, limit: number) =>
    decisionLogUrl({ offset, limit, sort: "createdAt", dir: "desc", locale: "cs", kind: "", attribution: null, q: "" });
  const header = (offset: number, limit: number) =>
    decisionLogUrl({ offset, limit, sort: "createdAt", dir: "desc", locale: "cs" });
  assert.equal(table(0, TRAIL_FETCH_LIMIT), header(0, TRAIL_FETCH_LIMIT));

  // …and both then serialize through decisionCsvRows with the same labels, renderers
  // and scope, so a trail collected through either path is the same file.
  const rows = [decision({ id: 1 }), decision({ id: 2, candidateLabel: "=cmd()" })];
  const trail = (url: (o: number, l: number) => string) =>
    collectDecisionTrail(async (offset, limit) => {
      assert.equal(url(offset, limit), table(offset, limit));
      return page({ decisions: rows, total: 2, hasMore: false, nextOffset: 2 });
    });
  const viaTable = await trail(table);
  const viaHeader = await trail(header);
  assert.deepEqual(
    decisionCsvRows(viaTable.rows, LABELS, RENDER, SCOPE),
    decisionCsvRows(viaHeader.rows, LABELS, RENDER, SCOPE)
  );
});
