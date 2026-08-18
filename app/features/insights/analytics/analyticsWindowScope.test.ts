// UAT KAT-ANA-5 (×2, convergent with TOM-ANA-13) + TOM-ANA-7 (×2) — the 30/90-day
// switcher must not lie about its reach.
//
// The defect: the switcher lives in the always-rendered header (G9 keeps it there),
// so it sat with aria-pressed="true" above an entire section that reads no window
// (Quality & audit) and above /api/benchmarks, which takes no parameters at all. A
// reader picked "Last 30 days" and part of the page silently stayed all-time. The
// second half: for the DEFAULT all-time view `deltas` is null by design, so no delta
// chip renders anywhere — and the only explanation in the product was a `title`
// attribute on a chip that does not exist.
//
// What this pins, and why it is a source-level guard: the surfaces involved are
// .tsx components and route modules that import through the "@/…" alias, which
// Node's test runner does not resolve (same reasoning as
// app/api/rate-limit-contract.test.ts and upload-size-contract.test.ts). So the
// invariants are asserted over the writers' own source, comment-stripped — a claim
// printed on screen is checked against the endpoint that would have to back it,
// rather than against a hand-copied duplicate of the rule (M3).
//
// Runner: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ANALYTICS_SECTION_IDS } from "./sections/analyticsSections.ts";

/** Source with comments removed — otherwise the prose EXPLAINING an invariant
 *  would satisfy the assertion that checks it. */
function source(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

const BENCHMARKS_ROUTE = "../../../api/benchmarks/route.ts";
const ANALYTICS_ROUTE = "../../../api/analytics/route.ts";

test("the company benchmark is all-time in BOTH the endpoint and the claim on screen", () => {
  const route = source(BENCHMARKS_ROUTE);
  const panel = source("./AnalyticsOrgBenchmarkPanel.tsx");

  // The endpoint takes no window: no Request argument, no searchParams read, no
  // `days` anywhere in live code. This is a decision (k-anonymity floor + the
  // truncation bias on medianTimeToHireDays) recorded at the route and in
  // app/_lib/db/org-benchmarks.ts — not an oversight to be quietly "fixed".
  const routeWindowed = /searchParams|\bdays\b/.test(route);
  assert.equal(routeWindowed, false, "/api/benchmarks read a window param — see the route's WINDOW SCOPE note before threading one");
  assert.match(route, /export async function GET\(\s*\)/, "/api/benchmarks GET must take no request argument");

  // …and the panel says so where the numbers are read, the compute panel's
  // manualAllTime / manualWindowed idiom.
  const panelClaimsAllTime = panel.includes('t("scopeAllTime")');
  assert.equal(panelClaimsAllTime, true, "OrgBenchmarkPanel must print the scope actually in force (analytics.orgBenchmark.scopeAllTime)");

  // The pairing is the point: an all-time CLAIM over a windowed endpoint is the
  // exact defect this item exists to remove, in the opposite direction.
  assert.ok(!(routeWindowed && panelClaimsAllTime), "the benchmark endpoint became windowed while the panel still claims all-time");
});

test("the window switcher states its reach, and names the sections it cannot govern", () => {
  const header = source("./AnalyticsHeader.tsx");

  // The scope line is the switcher's accessible DESCRIPTION, not decoration
  // beside it — a screen-reader user hears the scope with the control.
  assert.match(header, /aria-describedby=\{scopeNoteId\}/, "the window group must describe itself with the scope note");
  assert.match(header, /id=\{scopeNoteId\}/, "the scope note must carry the id the group points at");

  // Three states, three truths: this section ignores the window · a window is in
  // force and here is what it misses · all-time is why there are no deltas.
  for (const key of ["windowScopeBlind", "windowDeltaHint", "windowScopeReach"]) {
    assert.ok(header.includes(`t("${key}")`), `the header must render analytics.${key}`);
  }

  // The blind list is checked against the real section vocabulary, so a renamed
  // or removed section cannot leave a dead id silently greying nothing.
  const declared = header.match(/WINDOW_BLIND_SECTIONS: readonly AnalyticsSectionId\[\] = \[([^\]]*)\]/);
  assert.ok(declared, "AnalyticsHeader must declare WINDOW_BLIND_SECTIONS");
  const blind = [...declared[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(blind.length > 0, "WINDOW_BLIND_SECTIONS must not be empty while a section ignores the window");
  for (const id of blind) {
    assert.ok((ANALYTICS_SECTION_IDS as readonly string[]).includes(id), `WINDOW_BLIND_SECTIONS names "${id}", which is not an analytics section`);
  }
  // Quality & audit is window-blind by DESIGN (G4/§2.23: the audit trail is
  // server-paged and never windowed), so it must stay on this list — dropping it
  // silently re-creates a pressed control governing nothing.
  assert.ok(blind.includes("quality"), "Quality & audit reads no window (the audit trail is deliberately unwindowed) and must stay declared blind");
});

test("the all-time default really has no deltas — which is what the hint explains", () => {
  // The hint („a comparison with the previous period appears once you pick 30 or
  // 90 days") is only honest while the route keeps returning null deltas for the
  // unwindowed view. Pinned against the writer so the copy cannot outlive it.
  const route = source(ANALYTICS_ROUTE);
  assert.match(
    route,
    /const deltas = windowDays[\s\S]*?:\s*null;/,
    "/api/analytics no longer returns null deltas for the all-time view — the header's windowDeltaHint copy is now false"
  );
});
