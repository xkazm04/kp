import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TENANCY_SCOPED_TABLES,
  TENANCY_EXEMPT_TABLES,
  tenancyGaps,
  assertTenancyReady,
} from "./tenancy.ts";

test("tenancyGaps treats every non-scoped, non-exempt table as a gap (fail closed)", () => {
  const tables = ["analyses", "profiles", "workspaces", "pipeline_entries", "jobs", "offers"];
  const gaps = tenancyGaps(tables);
  // analyses/profiles are scoped, workspaces is exempt; the rest are gaps.
  assert.deepEqual(gaps, ["jobs", "offers", "pipeline_entries"]);
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
    () => assertTenancyReady(["analyses", "jobs"], true),
    /KP_MULTI_WORKSPACE is enabled but 1 table\(s\) are not workspace-scoped: jobs/,
  );
});

test("assertTenancyReady permits multi-workspace when nothing is a gap", () => {
  const tables = [...TENANCY_SCOPED_TABLES, ...TENANCY_EXEMPT_TABLES];
  assert.doesNotThrow(() => assertTenancyReady(tables, true));
});
