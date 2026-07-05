import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TENANCY_SCOPED_TABLES,
  TENANCY_EXEMPT_TABLES,
  tenancyGaps,
  assertTenancyReady,
} from "./tenancy.ts";

test("tenancyGaps treats every non-scoped, non-exempt table as a gap (fail closed)", () => {
  // Synthetic table names so this LOGIC test stays stable as real tables get scoped.
  const tables = ["analyses", "profiles", "workspaces", "alpha_widget", "beta_gadget"];
  const gaps = tenancyGaps(tables);
  // analyses/profiles are scoped, workspaces is exempt; the two synthetic tables are gaps.
  assert.deepEqual(gaps, ["alpha_widget", "beta_gadget"]);
});

test("a brand-new table is a gap by default", () => {
  assert.deepEqual(tenancyGaps(["analyses", "some_new_table"]), ["some_new_table"]);
});

test("sqlite-internal tables are never gaps", () => {
  assert.deepEqual(tenancyGaps(["sqlite_sequence", "sqlite_stat1", "analyses"]), []);
});

test("a fully-scoped table list yields no gaps", () => {
  const tables = [...TENANCY_SCOPED_TABLES, ...TENANCY_EXEMPT_TABLES];
  assert.deepEqual(tenancyGaps(tables), []);
});

test("scoped and exempt sets do not overlap (a table can't be both)", () => {
  for (const t of TENANCY_SCOPED_TABLES) {
    assert.ok(!TENANCY_EXEMPT_TABLES.has(t), `${t} is both scoped and exempt`);
  }
});

test("assertTenancyReady is a no-op in the single-tenant lock even with gaps", () => {
  assert.doesNotThrow(() => assertTenancyReady(["jobs", "offers"], false));
});

test("assertTenancyReady refuses multi-workspace while a per-tenant table is unscoped", () => {
  assert.throws(
    () => assertTenancyReady(["analyses", "unscoped_widget"], true),
    /KP_MULTI_WORKSPACE is enabled but 1 table\(s\) are not workspace-scoped: unscoped_widget/,
  );
});

test("assertTenancyReady permits multi-workspace when nothing is a gap", () => {
  const tables = [...TENANCY_SCOPED_TABLES, ...TENANCY_EXEMPT_TABLES];
  assert.doesNotThrow(() => assertTenancyReady(tables, true));
});
