// The catalog joins the views make by closed vocabulary (next-intl keys are typed, so these are cast joins): every kind,
// phase, status, rung, autopilot mode, event, sort and rack the surface can name has its words, in all four catalogs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PHASES, SORTS, KNOWN_EVENTS, EXIT_STEPS, LIFE_STEPS } from "./workforceModel.ts";
import { NEXT_ACTION_PRIORITY } from "./agentsWorkforceLogic.ts";
import { autopilotKey, rungKey } from "./workforceCopy.ts";

const LOCALES = ["en", "cs", "de", "fr"] as const;
type Node = { [key: string]: Node | string | undefined };
const cat = (l: string): Node => (JSON.parse(readFileSync(new URL(`../../../messages/${l}.json`, import.meta.url), "utf8")) as { agentsWorkforce: Node }).agentsWorkforce;
const has = (c: Node, path: string): boolean => {
  let cur: Node | string | undefined = c;
  for (const k of path.split(".")) cur = typeof cur === "object" && cur !== null ? cur[k] : undefined;
  return cur != null;
};

test("rungs and autopilot modes name keys the catalog has", () => {
  for (const l of LOCALES) {
    const c = cat(l);
    for (const r of [0, 1, 2, null, 3, 99]) assert.ok(has(c, rungKey(r)), `${l} ${rungKey(r)}`);
    for (const m of ["off", "measure", "suggest", "full", null] as const) assert.ok(has(c, autopilotKey(m)), `${l} ${autopilotKey(m)}`);
  }
  assert.equal(rungKey(3), "appMaster.rung.unknown", "rungs 3 and 4 are never grantable, so never a held rung");
});

test("every closed vocabulary has words in every locale", () => {
  for (const l of LOCALES) {
    const c = cat(l);
    for (const k of NEXT_ACTION_PRIORITY) {
      assert.ok(has(c, `wk.kindShort.${k}`), `${l} kindShort ${k}`);
      assert.ok(has(c, `nextAction.chip.${k}`), `${l} chip ${k}`);
    }
    for (const p of PHASES) {
      assert.ok(has(c, `wk.phase.${p}`) && has(c, `wk.phasePlural.${p}`), `${l} phase ${p}`);
    }
    for (const s of SORTS) assert.ok(has(c, `wk.sort.${s}`), `${l} sort ${s}`);
    for (const e of KNOWN_EVENTS) assert.ok(has(c, `wk.event.${e}`), `${l} event ${e}`);
    for (const st of [...LIFE_STEPS, ...EXIT_STEPS]) assert.ok(has(c, `wk.rack.empty.${st}`), `${l} rack ${st}`);
    for (const d of ["all", "other", "gigs", "appmaster"]) assert.ok(has(c, `wk.drawer.${d}`), `${l} drawer ${d}`);
    for (const s of ["dispatched", "pendingApproval", "onboarding", "active", "rejected", "failed", "retired"]) assert.ok(has(c, `status.${s}`), `${l} status ${s}`);
    for (const r of ["never_heard", "none_accepted", "uncosted", "no_runs", "no_reading"]) assert.ok(has(c, `wk.noData.${r}`), `${l} noData ${r}`);
    for (const s of ["met", "missed", "nodata"]) assert.ok(has(c, `wk.metricState.${s}`), `${l} metricState ${s}`);
    for (const k of ["mint", "pending", "decision", "report", "activity", "absent.never_heard", "absent.none_accepted"]) assert.ok(has(c, `wk.ledger.${k}`), `${l} ledger ${k}`);
  }
});

test("the retired roster table's keys are gone (no orphan copy)", () => {
  for (const l of LOCALES) {
    const c = cat(l);
    assert.equal(c.col, undefined, `${l} col`);
    assert.equal(c.heardFrom, undefined, `${l} heardFrom`);
  }
});
