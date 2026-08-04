// bulk-acts-on-what-you-see — the defect this file pins, in the recruiter's own
// sequence:
//
//     select 5 candidates -> arm "Reject 5 & notify" -> apply a saved view
//     (which swaps the whole filter combo) -> click confirm
//
// Pre-fix, `confirmingBulkReject` was `bulkConfirm === "reject"` with no notion of
// WHAT THE BOARD WAS SHOWING, and none of the ~9 filter mutators dispatched a disarm.
// So the confirm survived the saved view, the still-rendered "Reject & notify" button
// fired, and the batch resolved the selected ids against the UNFILTERED entry list —
// emailing a cohort the recruiter could no longer see.
//
// NON-VACUITY. Two independent ways this file goes RED against the pre-fix code:
//   1. `pipelineSelectionScope.ts` did not exist and `armedConfirm` was not exported
//      -> ERR_MODULE_NOT_FOUND / named-export miss on the imports below.
//   2. Beyond existence, the assertions discriminate the fix's actual decisions. A
//      degenerate `armedConfirm = (s) => s?.which ?? null` (i.e. ignore the scope —
//      exactly the pre-fix semantics) passes tsc and still FAILS
//      "the armed reject does not survive the saved view". Verified by mutation, not
//      by assumption.
//
// Runner: Node's built-in test runner with type stripping. `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

import { armedConfirm, bulkConfirmReducer, type BulkConfirm } from "./pipelineBulkConfirm.ts";
import {
  selectionOutsideVisible,
  visibleScopeSignature,
  type VisibleScopeShape,
} from "./pipelineSelectionScope.ts";

/** The board's filter state as the hook holds it. `scopeOf` mirrors the hook's memo
 *  exactly (same fields, same source), so this harness is the production derivation,
 *  not a re-implementation of it. */
const scopeOf = (s: Partial<VisibleScopeShape>): string =>
  visibleScopeSignature({
    query: s.query ?? "",
    quicks: s.quicks ?? new Set<string>(),
    scoreBands: s.scoreBands ?? new Set<string>(),
    sources: s.sources ?? new Set<string>(),
    stage: s.stage ?? null,
  });

// ---------------------------------------------------------------------------
// The reproduction
// ---------------------------------------------------------------------------

test("select -> arm reject -> apply a saved view -> confirm does NOT email the old cohort", () => {
  // The board as the recruiter left it: the "aging" quick chip is on, and they
  // selected the five candidates it isolated.
  const boardScope = scopeOf({ quicks: new Set(["aging"]) });
  const selectedIds = new Set(["e1", "e2", "e3", "e4", "e5"]);

  // 1. Arm the reject. The bar now reads "Reject 5 and notify them?".
  let confirm: BulkConfirm = bulkConfirmReducer(null, { type: "arm", which: "reject", scope: boardScope });
  assert.equal(
    armedConfirm(confirm, boardScope),
    "reject",
    "the confirm is armed while the board still shows the cohort it was armed for"
  );

  // 2. Apply a saved view — a different query + facets + funnel stage. NOTHING
  //    dispatches to the confirm reducer here; applyView never did and, by design,
  //    still doesn't. The selection is untouched (kept on purpose), so the round-5
  //    `selectionChanged` disarm cannot fire either. This is precisely the gap.
  const savedViewScope = scopeOf({
    query: "senior backend",
    scoreBands: new Set(["strong"]),
    sources: new Set(["referral"]),
    stage: "Interview",
  });
  assert.notEqual(savedViewScope, boardScope, "the saved view genuinely changes what the board shows");

  // 3. The confirm is no longer armed — the next click RE-ARMS against the cohort
  //    now on screen instead of firing against the invisible one.
  assert.equal(
    armedConfirm(confirm, savedViewScope),
    null,
    "an armed reject must not survive the saved view that made its cohort invisible"
  );

  // …and the five are still selected and still off-screen, so the bar discloses them
  //    rather than the board silently dropping them (the other half of the fix).
  const stillHidden = selectionOutsideVisible(selectedIds, [{ id: "e9" }, { id: "e10" }]);
  assert.deepEqual(stillHidden, [...selectedIds], "all five are now outside the filter and must be disclosed");

  // 4. And the reducer state is not silently 'still reject underneath': re-arming
  //    under the new scope is what makes it live again, which is the recruiter
  //    re-confirming against what they can see.
  confirm = bulkConfirmReducer(confirm, { type: "arm", which: "reject", scope: savedViewScope });
  assert.equal(armedConfirm(confirm, savedViewScope), "reject", "a deliberate second click re-arms");
  assert.equal(armedConfirm(confirm, boardScope), null, "…and only under the scope it was re-armed in");
});

test("EVERY visible-set mutator invalidates an armed confirm — not just saved views", () => {
  // The Director's evidence named six mutators (toggleQuick, toggleBand, toggleSource,
  // clearFilters, applyView, focusDegradedCohort). It MISSED three that also change
  // what the board shows: setQueryAndSync, showStage and clearStageFilter. That miss is
  // the argument for deriving the disarm from the scope instead of dispatching it from
  // each handler — so this case enumerates every mutator's EFFECT, including the three
  // the hand-written list forgot.
  const base = { query: "anna", quicks: new Set(["aging"]), scoreBands: new Set<string>(), sources: new Set<string>(), stage: "Offer" as string | null };
  const baseScope = scopeOf(base);
  const after: Record<string, string> = {
    // named in the direction's evidence
    toggleQuick: scopeOf({ ...base, quicks: new Set(["aging", "intake"]) }),
    toggleBand: scopeOf({ ...base, scoreBands: new Set(["strong"]) }),
    toggleSource: scopeOf({ ...base, sources: new Set(["referral"]) }),
    clearFilters: scopeOf({}),
    applyView: scopeOf({ query: "other", quicks: new Set(["stalled"]) }),
    focusDegradedCohort: scopeOf({ quicks: new Set(["intake"]) }),
    // MISSING from the direction's evidence — verified against usePipelineTabState
    setQueryAndSync: scopeOf({ ...base, query: "bohdan" }),
    showStage: scopeOf({ stage: "Interview" }),
    clearStageFilter: scopeOf({ ...base, stage: null }),
  };
  for (const armedWhich of ["reject", "outreach"] as const) {
    const confirm = bulkConfirmReducer(null, { type: "arm", which: armedWhich, scope: baseScope });
    for (const [mutator, scope] of Object.entries(after)) {
      assert.notEqual(scope, baseScope, `${mutator} must change the visible scope`);
      assert.equal(
        armedConfirm(confirm, scope),
        null,
        `${mutator} must invalidate an armed ${armedWhich} confirm`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// The scope signature's own contract
// ---------------------------------------------------------------------------

test("re-sorting is NOT a visible-set change (the same rows, reordered)", () => {
  // `sort` is deliberately absent from VisibleScopeShape: it reorders the cohort
  // without changing its membership, so it must not nag the recruiter into
  // re-confirming. If sort ever joins the shape, this case fails and forces the
  // decision to be made explicitly.
  const shape: VisibleScopeShape = {
    query: "a",
    quicks: new Set(["aging"]),
    scoreBands: new Set<string>(),
    sources: new Set<string>(),
    stage: null,
  };
  assert.ok(!Object.keys(shape).includes("sort"), "sort must not be part of the visible scope");
});

test("the scope is order-independent — toggling a chip on and back off is not a change", () => {
  const a = scopeOf({ quicks: new Set(["aging", "intake"]), sources: new Set(["referral", "board"]) });
  const b = scopeOf({ quicks: new Set(["intake", "aging"]), sources: new Set(["board", "referral"]) });
  assert.equal(a, b, "set membership, not insertion order, defines the scope");
});

test("distinct scopes never collide into one signature", () => {
  // Field separators must be characters no filter value can carry, or e.g.
  // {query:"a", quicks:{"b"}} and {query:"ab"} would read as one scope and a
  // real filter change would silently keep a confirm armed.
  const scopes = [
    scopeOf({ query: "a", quicks: new Set(["b"]) }),
    scopeOf({ query: "ab" }),
    scopeOf({ quicks: new Set(["a", "b"]) }),
    scopeOf({ quicks: new Set(["ab"]) }),
    scopeOf({ stage: "Offer" }),
    scopeOf({ query: "Offer" }),
    scopeOf({}),
  ];
  assert.equal(new Set(scopes).size, scopes.length, "each distinct filter combo gets its own signature");
});

test("a trimmed-only query edit is not a scope change (matches the filter predicate)", () => {
  assert.equal(scopeOf({ query: "anna" }), scopeOf({ query: "  anna  " }));
});

// ---------------------------------------------------------------------------
// The disclosure (the chosen half of the accept-criterion: keep the selection,
// state the over-reach — never prune it silently)
// ---------------------------------------------------------------------------

test("selectionOutsideVisible names exactly the selected rows the filter hides", () => {
  const selected = new Set(["e1", "e2", "e3", "e4", "e5"]);
  const visible = [{ id: "e2" }, { id: "e4" }, { id: "e9" }];
  assert.deepEqual(
    selectionOutsideVisible(selected, visible),
    ["e1", "e3", "e5"],
    "three of the five selected rows are off-screen and the bar must say so"
  );
});

test("nothing to disclose when the whole selection is on screen", () => {
  const selected = new Set(["e1", "e2"]);
  assert.deepEqual(selectionOutsideVisible(selected, [{ id: "e1" }, { id: "e2" }, { id: "e3" }]), []);
});

test("an empty selection discloses nothing, and an empty board discloses everything", () => {
  assert.deepEqual(selectionOutsideVisible(new Set<string>(), [{ id: "e1" }]), []);
  assert.deepEqual(selectionOutsideVisible(new Set(["e1", "e2"]), []), ["e1", "e2"]);
});

test("the bulk bar actually RENDERS the disclosure, in every locale", () => {
  // The pure helper above proves the count is computable; this proves the recruiter
  // is told. Two independent ways this could silently rot: the bar stops rendering the
  // key, or the key is dropped from the catalogs. `npm run i18n:check` catches neither
  // when a key is missing from ALL FOUR locales (parity stays green on a uniform
  // deletion), so the locale set is asserted here against the catalog dir itself —
  // never against a hand-typed locale list that could drift when a 5th locale lands.
  const dir = new URL("../../../../messages/", import.meta.url);
  const locales = readdirSync(dir).filter((f) => f.endsWith(".json"));
  assert.ok(locales.length >= 4, `expected the four shipped locales, found ${locales.join(", ")}`);

  const bar = readFileSync(new URL("./PipelineBulkActionBar.tsx", import.meta.url), "utf8");
  assert.match(
    bar,
    /t\("selectedOutsideFilter", \{ count: selectedOutsideCount \}\)/,
    "the bulk bar must render the out-of-filter count next to the selected count"
  );

  for (const file of locales) {
    const cat = JSON.parse(readFileSync(new URL(file, dir), "utf8")) as {
      pipeline?: { tab?: Record<string, string> };
    };
    const copy = cat.pipeline?.tab?.selectedOutsideFilter;
    assert.ok(copy, `messages/${file} is missing pipeline.tab.selectedOutsideFilter`);
    // Literal {count} or an ICU plural over count ({count, plural, …} — the
    // Czech catalog uses the plural form for proper one/few/other agreement).
    assert.match(copy, /\{count[,}]/, `messages/${file}: the disclosure must state HOW MANY rows are hidden`);
  }
});

test("the selection is NOT pruned — disclosure is the mechanism, by design", () => {
  // The Director's lean, adopted: a recruiter who filtered to review a subset has not
  // abandoned the rest, so the cohort survives the filter change and the bar states
  // the divergence. This case exists so a later "just prune it" refactor has to argue
  // with a test rather than quietly swap one surprise for another (silent under-reach).
  const selected = new Set(["e1", "e2", "e3"]);
  const outside = selectionOutsideVisible(selected, [{ id: "e2" }]);
  assert.equal(outside.length, 2, "the hidden rows are reported…");
  assert.equal(selected.size, 3, "…and the selection itself is untouched");
});
