// challenge-r03 devcase-workspace/B — Assignments as an ADDRESS.
//
// Three surfaces send a reader here with a destination in mind: the Control Room's
// Art. 22 gate Review link (?lifecycle=), the job page's "N assignments" chip
// (?job=), and any share of one case (?case=). The tab used to read none of it:
// view and selection were local state and the review panel opened only on its own
// click. These cases pin the pure half - parse, resolve against what is loaded,
// consume - and the two wiring facts a pure test cannot reach.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  LIFECYCLE_WINDOW,
  consumedSearch,
  parseAssignmentsLink,
  resolveAssignmentsLink,
} from "./assignmentsDeepLink.ts";
import { filterCasesUrl } from "./casesPage.ts";
import { EMPTY_CASE_FILTERS, caseFiltersActive } from "./DevCasesTable.filter.ts";
import { TAB_SCOPED_PARAM_KEYS } from "../../shell/tabs.ts";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, "..", "..", "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

test("1. parse: one intent per address, case > lifecycle > job, blanks are nothing", () => {
  assert.deepEqual(parseAssignmentsLink("tab=assignments&lifecycle=lc_1"), { kind: "lifecycle", id: "lc_1" });
  assert.deepEqual(parseAssignmentsLink("case=c_9"), { kind: "case", id: "c_9" });
  assert.deepEqual(parseAssignmentsLink("?job=j_1"), { kind: "job", id: "j_1" });
  assert.equal(parseAssignmentsLink(""), null);
  assert.equal(parseAssignmentsLink("tab=assignments"), null);
  assert.equal(parseAssignmentsLink("lifecycle=&case=%20%20"), null);
  assert.deepEqual(parseAssignmentsLink("job=j_1&lifecycle=lc_1&case=c_9"), { kind: "case", id: "c_9" });
  assert.deepEqual(parseAssignmentsLink("job=j_1&lifecycle=lc_1"), { kind: "lifecycle", id: "lc_1" });
  assert.deepEqual(parseAssignmentsLink(new URLSearchParams("lifecycle=%20lc_2%20")), { kind: "lifecycle", id: "lc_2" });
});

test("2. a lifecycle awaiting approval opens its review and is focused", () => {
  assert.deepEqual(
    resolveAssignmentsLink(
      { kind: "lifecycle", id: "lc_1" },
      { lifecycles: [{ id: "lc_1", stage: "awaiting_approval" }], loaded: true },
    ),
    { view: "cases", openReview: "lc_1", focus: "lc_1" },
  );
});

test("3. a gate decided since the link was minted is focused and SAYS so, with no review", () => {
  const r = resolveAssignmentsLink(
    { kind: "lifecycle", id: "lc_1" },
    { lifecycles: [{ id: "lc_1", stage: "collecting" }], loaded: true },
  );
  assert.deepEqual(r, { view: "cases", focus: "lc_1", notice: { kind: "gateDecided", stage: "collecting" } });
  assert.ok(!("openReview" in r));
});

test("4. an absent lifecycle names why and changes no selection; before the first load it waits", () => {
  const others = [{ id: "lc_other", stage: "collecting" }];
  assert.deepEqual(
    resolveAssignmentsLink({ kind: "lifecycle", id: "lc_1" }, { lifecycles: others, loaded: true }),
    { view: "cases", notice: { kind: "lifecycleMissing" } },
  );
  assert.deepEqual(resolveAssignmentsLink({ kind: "lifecycle", id: "lc_1" }, { lifecycles: [], loaded: false }), { pending: true });
  // The lifecycle list is the newest LIFECYCLE_WINDOW only. A full window cannot
  // prove absence, so the notice says "older than what is listed", not "missing".
  const full = Array.from({ length: LIFECYCLE_WINDOW }, (_, i) => ({ id: `lc_${i + 100}`, stage: "collecting" }));
  assert.deepEqual(
    resolveAssignmentsLink({ kind: "lifecycle", id: "lc_1" }, { lifecycles: full, loaded: true }),
    { view: "cases", notice: { kind: "lifecycleOutsideWindow" } },
  );
});

test("5. a case opens its reader by id, loaded page or not (the reader reads GET /api/devcase/[id])", () => {
  assert.deepEqual(
    resolveAssignmentsLink({ kind: "case", id: "c_9" }, { lifecycles: [], loaded: false }),
    { view: "cases", selectedCaseId: "c_9" },
  );
  // A foreign or deleted id is answered by the reader's coded 404 with the way back.
  const view = read("app/features/tools/devcases/DevTabCasesView.tsx");
  assert.match(view, /\/api\/devcase\/\$\{encodeURIComponent\(caseId\)\}/);
});

test("6. a job filters the ledger to that role, as part of the query", () => {
  assert.deepEqual(
    resolveAssignmentsLink({ kind: "job", id: "j_1" }, { lifecycles: [], loaded: false }),
    { view: "cases", jobFilter: "j_1" },
  );
  assert.equal(
    filterCasesUrl({ limit: 50, title: "", stage: "", seniority: "", job: "j_1" }),
    "/api/devcase?limit=50&job=j_1",
  );
  assert.equal(caseFiltersActive({ ...EMPTY_CASE_FILTERS, job: "j_1" }), true);
  assert.equal(caseFiltersActive(EMPTY_CASE_FILTERS), false);
  const route = read("app/api/devcase/route.ts");
  assert.match(route, /job: params\.get\("job"\)/, "GET /api/devcase passes ?job= to the store");
});

test("7. the address is consumed once, and a bare tab switch clears it", () => {
  assert.equal(consumedSearch("tab=assignments&lifecycle=lc_1&lang=cs"), "tab=assignments&lang=cs");
  assert.equal(consumedSearch("?case=c_9&job=j_1"), "");
  assert.equal(consumedSearch("lang=cs"), "lang=cs");
  const scoped = TAB_SCOPED_PARAM_KEYS as readonly string[];
  assert.ok(scoped.includes("case"));
  assert.ok(scoped.includes("lifecycle"));
  assert.ok(scoped.includes("job"));
  const tab = read("app/features/tools/devcases/DevTab.tsx");
  assert.match(tab, /parseAssignmentsLink\(/, "DevTab reads the address");
  assert.match(tab, /consumedSearch\(/, "…and strips it after use");
  assert.match(tab, /history\.replaceState/, "the ?arm= one-shot shape");
});

test("8. the job page's assignments chip lands on that job's assignments", () => {
  const strip = read("app/features/library/jobs/JobsLifecycleStrip.tsx");
  assert.match(strip, /key: "assignments",[^\n]*?tab: "assignments", params: \{ job: jobId \}/);
  const row = read("app/features/tools/devcases/DevLifecycleRow.tsx");
  assert.match(row, /scrollIntoView/, "a focused lifecycle row is brought into view");
});
