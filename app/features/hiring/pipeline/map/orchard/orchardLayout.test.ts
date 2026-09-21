import test from "node:test";
import assert from "node:assert/strict";
import { branchFit, cornerCallouts, salaryBranches, type BandRow } from "./orchardLayout";

// The orchard's salary columns used to start at a 5 000 step, which is a CZK-shaped
// assumption: once the organization labels its bands in EUR (org currency setting),
// a 3–6k band collapsed into a single column. The step floor now follows magnitude.

const pts = (...mids: number[]) => mids.map((midpoint, i) => ({ id: `c${i}`, midpoint }));

test("a koruna-sized band keeps its 5k columns", () => {
  const branches = salaryBranches(pts(45500, 47000, 52000, 58500, 61000));
  assert.deepEqual(
    branches.map((b) => [b.lo, b.hi]),
    [
      [45000, 50000],
      [50000, 55000],
      [55000, 60000],
      [60000, 65000],
    ],
  );
});

test("a euro-sized band is not collapsed into one column", () => {
  const branches = salaryBranches(pts(3100, 3600, 4200, 4900, 5600));
  assert.ok(branches.length >= 3, `expected several columns, got ${branches.length}`);
  assert.ok(branches[0].hi - branches[0].lo <= 1000, "the step follows the band's magnitude");
});

test("never more than six non-empty columns, every point placed once", () => {
  const points = pts(...Array.from({ length: 40 }, (_, i) => 30000 + i * 1700));
  const branches = salaryBranches(points);
  assert.ok(branches.length <= 6);
  assert.equal(branches.flatMap((b) => b.ids).length, points.length);
});

test("branch fit against the role band", () => {
  const b = { lo: 50000, hi: 55000, ids: [] };
  assert.equal(branchFit(b, [45000, 60000]), "inside");
  assert.equal(branchFit(b, [20000, 40000]), "above");
  assert.equal(branchFit(b, [70000, 90000]), "below");
  assert.equal(branchFit(b, null), null);
});

test("corner callouts need two distinct occupied cells on the top band", () => {
  const row = (cells: number[]): BandRow => ({
    band: "strong",
    cells: cells.map((n) => Array.from({ length: n }) as BandRow["cells"][number]),
    total: cells.reduce((a, b) => a + b, 0),
  });
  assert.deepEqual(cornerCallouts([row([1, 0, 2])]), { gemsAt: 0, prosAt: 2 });
  assert.deepEqual(cornerCallouts([row([0, 3, 0])]), { gemsAt: -1, prosAt: -1 });
  assert.deepEqual(cornerCallouts([]), { gemsAt: -1, prosAt: -1 });
});
