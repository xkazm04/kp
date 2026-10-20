// The Broadsheet reads every role: pages until the total is covered, merged by role, with a role
// that straddles a page boundary re-read whole (its halves carry half-cohort rails).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { JourneyBoard, RoleCluster } from "@/app/_lib/journey/types";
import { boardCoverage, mergeBoardPages, remainingOffsets, replaceClusters } from "./journeyPages.ts";

const col = (id: string) => ({ entryId: id }) as unknown as RoleCluster["columns"][number];
const cluster = (jobId: string, ids: string[]): RoleCluster =>
  ({ jobId, title: jobId, roleArea: null, openedAt: "", sharedEvents: [], sharedEventsUnlinked: false, rail: [], columns: ids.map(col), totalColumns: ids.length }) as RoleCluster;
const page = (clusters: RoleCluster[], offset: number): JourneyBoard => ({
  clusters, totals: { roles: 3, columns: 104, events: 337 }, query: { activeOnly: false, limit: 50, offset },
});

test("the page offsets cover the total, inside the page budget", () => {
  assert.deepEqual(remainingOffsets(104, 50), [50, 100]);
  assert.deepEqual(remainingOffsets(50, 50), []);
  assert.deepEqual(remainingOffsets(2000, 50, 4), [50, 100, 150]);
});

test("pages merge by role in order; a role on two pages is named for a whole re-read", () => {
  const { board, split } = mergeBoardPages([page([cluster("a", ["1"]), cluster("b", ["2", "3"])], 0), page([cluster("b", ["4"]), cluster("c", ["5"])], 50)]);
  assert.deepEqual(board.clusters.map((c) => c.jobId), ["a", "b", "c"]);
  assert.deepEqual(split, ["b"]);
  assert.equal(board.clusters[1].columns.length, 3);
  const whole = replaceClusters(board, [cluster("b", ["2", "3", "4", "6"])]);
  assert.equal(whole.clusters[1].columns.length, 4);
  assert.deepEqual(boardCoverage(whole), { shown: 6, total: 104 });
});
