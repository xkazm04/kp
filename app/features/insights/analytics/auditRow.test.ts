// UAT §2.6 "The auditor's row" — the guards for the trip a DPO actually makes
// through the two audit tables (the sealed decision records and the decision log).
//
// Two kinds of assertion live here, deliberately:
//
//   1. BEHAVIOUR, over the pure helpers both tables and the decision-log route
//      share (analyticsDecisionLogTypes.ts). The Czech collation, the
//      diacritic-folded subject search, the one clock and the export provenance
//      block are all testable without a DOM or a DB, so they are pinned directly.
//   2. SOURCE-level guards, over the .tsx surfaces and the route modules, which
//      import through the "@/…" alias and JSX that node:test cannot render (the
//      same reasoning as analyticsWindowScope.test.ts and rate-limit-contract.test.ts).
//      These check that a claim printed on screen is still backed by the code that
//      would have to back it — several items in this drain exist BECAUSE the suite
//      pinned a vocabulary and nothing pinned the render map.
//
// Runner: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DECISION_META, RETIRED_EVENT_KINDS } from "@/app/_lib/decision-attribution";
import {
  compareDecisions,
  compareNames,
  foldForSearch,
  formatAuditTime,
  isRecordOnlyKind,
  matchesSubject,
  RECORD_ONLY_KINDS,
  shortHash,
  withExportProvenance,
} from "./analyticsDecisionLogTypes.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, "../../..");

/** Source with comments removed — otherwise the prose EXPLAINING an invariant
 *  would satisfy the assertion that checks it. */
function source(rel: string): string {
  return readFileSync(path.join(HERE, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

const RECORDS_TABLE = "./sections/DecisionRecordsTable.tsx";
const LOG_TABLE = "./sections/DecisionLogTable.tsx";
const RECORD_DETAIL = "./sections/DecisionRecordDetail.tsx";
const RECORDS_PANEL = "./AnalyticsDecisionRecordsPanel.tsx";
const LOG_ROUTE = "../../../api/analytics/decisions/route.ts";
const RECORDS_ROUTE = "../../../api/decisions/records/route.ts";

// ---- 1. Czech collation on the name sort (LUC-ANA-5) ------------------------

// Real surnames from the live seeded workspace. Under UTF-8 byte order (SQLite's
// BINARY collation, which is what `ORDER BY candidate_label` gives) every one of
// the four diacritic names sorts AFTER Zeman.
const CZECH_SURNAMES = ["Žák", "Adam", "Čermák", "Šimková", "Zeman", "Řezníčková", "Marek"];
const CZECH_ORDER = ["Adam", "Čermák", "Marek", "Řezníčková", "Šimková", "Zeman", "Žák"];

test("the name sort files Czech diacritics where a Czech reader looks for them", () => {
  const sorted = [...CZECH_SURNAMES].sort((a, b) => compareNames(a, b, "cs", "asc"));
  assert.deepEqual(sorted, CZECH_ORDER);
});

test("byte order — the ordering this replaces — puts every diacritic surname after Z", () => {
  const byteOrder = [...CZECH_SURNAMES].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  // The defect, pinned so a regression to a plain `<`/SQL ordering is visible:
  // Zeman ends up ahead of Čermák, Řezníčková, Šimková and Žák.
  assert.equal(byteOrder.indexOf("Zeman") < byteOrder.indexOf("Čermák"), true);
  assert.notDeepEqual(byteOrder, CZECH_ORDER);
});

test("descending reverses the collation but still pins missing names LAST", () => {
  const desc = [...CZECH_SURNAMES].sort((a, b) => compareNames(a, b, "cs", "desc"));
  assert.deepEqual(desc, [...CZECH_ORDER].reverse());
  // A board-level row (no candidate) must not float to the top of a descending sort:
  // a missing value is not a large value, exactly as useTableSort documents.
  assert.equal(compareNames(null, "Adam", "cs", "desc"), 1);
  assert.equal(compareNames(null, "Adam", "cs", "asc"), 1);
  assert.equal(compareNames("Adam", "", "cs", "desc"), -1);
  assert.equal(compareNames(null, undefined, "cs", "asc"), 0);
});

// ---- 2. Subject search (LUC-ANA-5) ------------------------------------------

test("subject search is diacritic-folded, so a Czech name is reachable from any keyboard", () => {
  assert.equal(matchesSubject("Čermák", "cermak"), true);
  assert.equal(matchesSubject("Řezníčková", "reznickova"), true);
  assert.equal(matchesSubject("Šimková", "SIMKOVA"), true);
  assert.equal(matchesSubject("Žák", "zak"), true);
  // Substring, not prefix: an auditor typing a first name finds the row too.
  assert.equal(matchesSubject("Marek Adam", "adam"), true);
  assert.equal(matchesSubject("Zeman", "novak"), false);
  assert.equal(foldForSearch("Čermák"), "cermak");
});

test("an empty subject search is not a filter", () => {
  assert.equal(matchesSubject("Zeman", ""), true);
  assert.equal(matchesSubject("Zeman", "   "), true);
  // A record whose subject ref never resolved is still searchable by its ref.
  assert.equal(matchesSubject(null, ""), true);
  assert.equal(matchesSubject(null, "zeman"), false);
});

// ---- 3. One clock, named (LUC-ANA-7) ----------------------------------------

const SEALED_AT = "2026-08-11T08:42:49.956Z";

test("an audit timestamp renders in the named zone, not as UTC pretending to be local", () => {
  const prague = formatAuditTime(SEALED_AT, "cs", "Europe/Prague");
  const utc = formatAuditTime(SEALED_AT, "cs", "UTC");
  // The exact defect: 10:42 in Prague read 08:42 on screen while the CSV wrote the
  // true instant, so screen and export disagreed by the offset on an audit artifact.
  assert.equal(prague.includes("10:42"), true, `expected 10:42 in Prague, got "${prague}"`);
  assert.equal(utc.includes("08:42"), true, `expected 08:42 in UTC, got "${utc}"`);
  assert.equal(prague.includes("2026"), true);
  assert.notEqual(prague, utc);
});

test("a blank or unparseable stamp renders nothing, never a fabricated date", () => {
  assert.equal(formatAuditTime("", "cs", "Europe/Prague"), "");
  assert.equal(formatAuditTime(null, "cs", "Europe/Prague"), "");
  assert.equal(formatAuditTime("not-a-date", "cs", "Europe/Prague"), "");
});

test("an unknown zone id falls back to the ISO instant instead of blanking the column", () => {
  const out = formatAuditTime(SEALED_AT, "cs", "Mars/Olympus_Mons");
  assert.equal(out.includes("08:42"), true, out);
});

// ---- 4. The refined ordering the decision-log route applies ------------------

const row = (id: number, candidateLabel: string | null, jobTitle: string | null = "Role", createdAt = SEALED_AT) => ({
  id,
  candidateLabel,
  jobTitle,
  kind: "advanced",
  createdAt,
});

test("the log's refined ordering collates names and breaks ties on the event id", () => {
  const rows = [row(1, "Zeman"), row(2, "Čermák"), row(3, "Žák"), row(4, null)];
  const sorted = [...rows].sort((a, b) => compareDecisions(a, b, "candidateLabel", "asc", "cs"));
  assert.deepEqual(
    sorted.map((r) => r.candidateLabel),
    ["Čermák", "Zeman", "Žák", null]
  );
  // Same name, different rows: newest id first, matching the store's `id DESC`
  // tiebreak so a refined page and a SQL page cannot disagree about row order.
  const ties = [row(7, "Zeman"), row(9, "Zeman"), row(8, "Zeman")];
  assert.deepEqual(
    [...ties].sort((a, b) => compareDecisions(a, b, "candidateLabel", "asc", "cs")).map((r) => r.id),
    [9, 8, 7]
  );
});

test("ordering by time stays chronological (the column is a UTC ISO instant)", () => {
  const rows = [row(1, "A", "R", "2026-08-11T08:00:00.000Z"), row(2, "B", "R", "2026-01-02T23:00:00.000Z")];
  const desc = [...rows].sort((a, b) => compareDecisions(a, b, "createdAt", "desc", "cs"));
  assert.deepEqual(desc.map((r) => r.id), [1, 2]);
});

// ---- 5. Every export names its own scope (LUC-ANA-11, G4) -------------------

test("an export leads with its provenance block, a blank separator, then the table", () => {
  const rows = withExportProvenance(
    [
      ["Scope", "Whole trail · 174 of 174 rows"],
      ["Time zone", "Europe/Prague"],
    ],
    ["Time", "Candidate"],
    [["2026-08-11 10:42", "Čermák"]]
  );
  assert.deepEqual(rows[0], ["Scope", "Whole trail · 174 of 174 rows"]);
  assert.deepEqual(rows[1], ["Time zone", "Europe/Prague"]);
  // The blank row is what stops a spreadsheet import reading the block as data.
  assert.deepEqual(rows[2], []);
  assert.deepEqual(rows[3], ["Time", "Candidate"]);
  assert.deepEqual(rows[4], ["2026-08-11 10:42", "Čermák"]);
});

test("the per-row fingerprint is short enough to scan and long enough to match", () => {
  const hash = "40c196618cbe7e8e7c56de391b38b8f397dba0a3dc2f54405eec3066bd4d0ae1";
  assert.equal(shortHash(hash), "40c19661…");
  // The same truncation the threshold-history strip already renders, so the two
  // fingerprint idioms in this tab read as one.
  assert.equal(shortHash(hash).startsWith(hash.slice(0, 8)), true);
});

// ---- 6. The kind vocabulary is covered end to end (LUC-ANA-9) ---------------

/** Every `kind:` a seal call site can write, read off the sources themselves so a
 *  new seal cannot quietly add an unlabelled kind. */
function sealedKinds(): Set<string> {
  const kinds = new Set<string>();
  const files = readdirSync(APP_ROOT, { recursive: true, encoding: "utf8" })
    .filter((f) => (f.endsWith(".ts") || f.endsWith(".tsx")) && !f.includes(".test."))
    .map((f) => path.join(APP_ROOT, f));
  const constants = new Map<string, string>();
  for (const [, name, value] of readFileSync(path.join(APP_ROOT, "_lib/decision-record-store.ts"), "utf8").matchAll(
    /export const (\w*KIND\w*) = "([a-z_]+)"/g
  )) {
    constants.set(name, value);
  }
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const match of src.matchAll(/sealDecision(?:Safe|Record)\(\s*\{?/g)) {
      const window = src.slice(match.index, match.index + 400);
      // Covers both the literal and the ternary form
      // (`kind: simActor ? "auto_advanced" : "advanced"`). A ternary CONDITION can
      // itself compare against a string (`action === "reject" ? …`), which is a
      // test, not a kind — drop the comparison operands before reading values.
      const line = /\n\s*kind:([^\n]*)/.exec(window);
      if (!line) continue;
      const expr = line[1].replace(/[=!]==?\s*"[a-z_]+"/g, "");
      for (const [, literal] of expr.matchAll(/"([a-z_]+)"/g)) kinds.add(literal);
      for (const [, name] of expr.matchAll(/\b([A-Z][A-Z0-9_]*)\b/g)) {
        const resolvedValue = constants.get(name);
        if (resolvedValue) kinds.add(resolvedValue);
      }
    }
  }
  return kinds;
}

test("every kind a seal can write has a localized label on the records table", () => {
  const kinds = sealedKinds();
  // Sanity: the scan found the call sites at all.
  assert.equal(kinds.size >= 10, true, `only found ${kinds.size} sealed kinds: ${[...kinds].join(", ")}`);
  const unlabelled = [...kinds].filter((k) => !(k in DECISION_META) && !isRecordOnlyKind(k));
  assert.deepEqual(
    unlabelled,
    [],
    `these sealed kinds would render as a de-snaked English token: ${unlabelled.join(", ")}. Map them in DECISION_META (if a pipeline event writes them too) or add them to RECORD_ONLY_KINDS plus analytics.decisionRecords.kinds.*`
  );
});

test("RECORD_ONLY_KINDS holds only kinds the log's catalog does NOT already label", () => {
  const overlap = RECORD_ONLY_KINDS.filter((k) => k in DECISION_META);
  assert.deepEqual(overlap, [], `these would be labelled twice, from two catalogs: ${overlap.join(", ")}`);
});

test("the retired-but-still-in-deployed-DBs kinds stay labelled", () => {
  // A dropped feature must not silently un-attribute history: the rows are still in
  // deployed databases, so the records table must keep resolving them through the
  // log's catalog rather than printing NEZNÁMÉ.
  for (const kind of RETIRED_EVENT_KINDS) {
    assert.equal(kind in DECISION_META, true, `retired kind "${kind}" lost its mapping`);
    assert.equal(isRecordOnlyKind(kind), false);
  }
});

// ---- 7. The render map, pinned at the surfaces (LUC-ANA-7/8/9/10) -----------

test("neither audit table renders a raw UTC slice as if it were local time", () => {
  for (const rel of [RECORDS_TABLE, LOG_TABLE]) {
    const src = source(rel);
    assert.equal(/createdAt\.slice\(0,\s*16\)/.test(src), false, `${rel} still renders createdAt.slice(0,16)`);
    assert.equal(src.includes("formatAuditTime("), true, `${rel} does not render through the shared audit clock`);
    // And the zone is NAMED on screen, not merely applied.
    assert.equal(src.includes('t("timeZoneNote"'), true, `${rel} applies a zone without naming it`);
  }
});

test("both audit tables offer a subject search", () => {
  for (const rel of [RECORDS_TABLE, LOG_TABLE]) {
    assert.equal(source(rel).includes('mode="search"'), true, `${rel} has no subject search`);
  }
});

test("the records table localizes its kind column instead of the English-only labelize()", () => {
  const src = source(RECORDS_TABLE);
  assert.equal(src.includes("labelize"), false, "labelize() is English-only and renders under a Czech header");
  assert.equal(src.includes("kindLabel(") && src.includes("isRecordOnlyKind("), true);
});

test("the records row carries the policy version and the content-hash fingerprint", () => {
  const src = source(RECORDS_TABLE);
  assert.equal(src.includes("r.policyVersion"), true, "policyVersion is sealed on every record and rendered nowhere");
  assert.equal(src.includes("shortHash(r.contentHash)"), true, "no per-row fingerprint to tie screen to export");
  assert.equal(src.includes('title={r.contentHash}'), true, "the full hash must stay reachable from the row");
});

test("the rationale is expandable and the expansion reaches the ?candidate= dossier", () => {
  const table = source(RECORDS_TABLE);
  assert.equal(table.includes("aria-expanded={isOpen}"), true, "the rationale does not expand");
  assert.equal(table.includes("DecisionRecordDetail"), true);
  const panel = source(RECORDS_PANEL);
  // LUC-GEF-L1-11 (rec 2): the route had zero UI callers for a full cycle.
  assert.equal(panel.includes("/api/decisions/records?candidate="), true, "the dossier route still has no UI caller");
  assert.equal(source(RECORD_DETAIL).includes("onExportDossier(record.candidateRef)"), true);
});

test("every export names its own scope and carries provenance", () => {
  const log = source(LOG_TABLE);
  assert.equal(log.includes("withExportProvenance("), true);
  assert.equal(log.includes('t("scopePage"') && log.includes('t("scopeTrail"'), true, "an export that cannot name its scope");
  // Both time columns: the rendered one matches the screen, the ISO one is the
  // unambiguous machine value. Dropping either is what made the two disagree.
  assert.equal(log.includes('t("csvTimeLocal"') && log.includes('t("csvTimeIso"'), true);
  assert.equal(source(RECORDS_PANEL).includes("provenance:"), true, "the JSON dossier carries no provenance block");
});

test("G5 — the CSV still goes through the central neutralizer, never a hand-rolled join", () => {
  const log = source(LOG_TABLE);
  assert.equal(log.includes("toCsv("), true);
  // A hand-built row string would bypass the leading =/+/-/@ neutralization that
  // export-utils applies once for every export in the studio.
  assert.equal(/\.join\(",",?\)/.test(log), false, "a hand-rolled CSV join bypasses the central neutralizer");
});

// ---- 8. The route guardrails (G4, G5) ---------------------------------------

test("G4 — the decision log stays server-paged and takes NO date window", () => {
  const route = source(LOG_ROUTE);
  for (const windowParam of ["days", "from", "to", "since", "window"]) {
    assert.equal(
      route.includes(`searchParams.get("${windowParam}")`),
      false,
      `the trail must never be windowed (a ?${windowParam}= filter was explicitly declined)`
    );
  }
  assert.equal(route.includes("countPipelineEvents("), true, "the pager must report position within the WHOLE trail");
});

test("G4 — a bounded refinement scan reports that it was bounded", () => {
  const route = source(LOG_ROUTE);
  assert.equal(route.includes("SUBJECT_REFINE_MAX"), true);
  // The bound is only honest if the response says when it bit.
  assert.equal(route.includes("capped: trailTotal > SUBJECT_REFINE_MAX"), true);
  assert.equal(source(LOG_TABLE).includes("subjectScan?.capped"), true, "the surface hides a bounded search");
});

test("G4 — seq stays visible in every ordering of the sealed chain", () => {
  const src = source(RECORDS_TABLE);
  assert.equal(src.includes("#{r.seq}"), true, "the chain position must be on every row, in every ordering");
});

test("G5 — the sealed-record reads keep the operator gate and the candidate projection", () => {
  const route = source(RECORDS_ROUTE);
  assert.equal(route.includes("requireOperator()"), true);
  assert.equal(route.includes('searchParams.get("candidate")'), true);
  // The candidate scope is applied by the STORE query, not by filtering a
  // whole-workspace read in the handler.
  assert.equal(route.includes("candidateRef: candidate"), true);
});
