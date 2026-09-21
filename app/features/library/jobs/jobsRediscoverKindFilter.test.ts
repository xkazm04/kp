// Pins the rediscover prior-kind filter (scan-sweep jobs-rediscovery).
// Isolating `closed` hides rejected rows; an empty (all-off) filter yields [] so
// the panel can show its filter-empty copy, not the pool-empty one.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_KINDS_ON,
  filterRediscoverByKind,
  kindFilterEmpty,
  toggleKind,
  type KindFilter,
} from "./jobsRediscoverKindFilter.ts";

const row = (kind: string) => ({ candidateId: kind, prior: { kind } });
const pool = [row("rejected"), row("closed"), row("elsewhere")];

test("each of the three kinds can be isolated", () => {
  for (const kind of ["rejected", "closed", "elsewhere"] as const) {
    const only: KindFilter = { rejected: false, closed: false, elsewhere: false, [kind]: true };
    const shown = filterRediscoverByKind(pool, only);
    assert.equal(shown.length, 1);
    assert.equal(shown[0].prior.kind, kind);
  }
});

test("filtering to closed hides rejected rows", () => {
  const closedOnly: KindFilter = { rejected: false, closed: true, elsewhere: false };
  assert.deepEqual(
    filterRediscoverByKind(pool, closedOnly).map((r) => r.prior.kind),
    ["closed"]
  );
});

test("an empty filter yields no rows (filter-empty, not pool-empty)", () => {
  const none: KindFilter = { rejected: false, closed: false, elsewhere: false };
  assert.equal(kindFilterEmpty(none), true);
  assert.deepEqual(filterRediscoverByKind(pool, none), []);
  assert.equal(kindFilterEmpty(ALL_KINDS_ON), false);
  assert.equal(filterRediscoverByKind(pool, ALL_KINDS_ON).length, 3);
});

test("toggleKind flips one kind and leaves the others", () => {
  const next = toggleKind(ALL_KINDS_ON, "rejected");
  assert.equal(next.rejected, false);
  assert.equal(next.closed, true);
  assert.equal(next.elsewhere, true);
});
