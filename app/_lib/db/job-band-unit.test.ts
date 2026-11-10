// A role's salary band carries its OWN unit (jobs.band_currency / band_period,
// docs/architecture/markets.md). Pins the four halves of that contract:
//   - the write stamps the workspace market's currency and period;
//   - a read after the market changed keeps the old unit, and the reader labels it;
//   - the boot backfill gives an unstamped band CZK/month (the only unit a band could
//     have been written in before markets existed), never the CURRENT market;
//   - every production writer stamps (a source contract over insertJob's callers).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { ensureDb, type JobRecord } from "./core.ts";
import { getJob, getJobsByIds, listJobsPage } from "./jobs.ts";
import { insertJob } from "../job-ingest.ts";
import { setDecisionConfig } from "../decision-config-store.ts";
import { getWorkspaceMarket } from "../workspace-market.ts";
import { bandInOtherUnit, bandUnitOf, withBandUnit } from "../salary-band.ts";

after(() => cleanupUnitDb());

const holder = globalThis as typeof globalThis & { __kpDb?: { close(): void } };

function role(id: string, band: number[] | undefined): JobRecord {
  return { id, title: `Role ${id}`, company: "Acme", salaryBand: band };
}

test("the write stamps the workspace market's currency and period on the band", () => {
  const ws = "ws-band-de";
  setDecisionConfig("market", { marketId: "de" }, ws, "team");
  insertJob(withBandUnit(role("band-de-1", [4000, 5200]), getWorkspaceMarket(ws)), undefined, "draft", ws);
  const job = getJob("band-de-1", ws);
  assert.equal(job?.bandCurrency, "EUR");
  assert.equal(job?.bandPeriod, "month");

  const gb = "ws-band-gb";
  setDecisionConfig("market", { marketId: "gb" }, gb, "team");
  insertJob(withBandUnit(role("band-gb-1", [52000, 64000]), getWorkspaceMarket(gb)), undefined, "draft", gb);
  assert.deepEqual(bandUnitOf(getJob("band-gb-1", gb)), { currency: "GBP", period: "year" });
});

test("a job with no band stores no unit", () => {
  insertJob(withBandUnit(role("band-none-1", []), getWorkspaceMarket("ws-band-none")), undefined, "draft", "ws-band-none");
  const row = ensureDb().prepare(`SELECT band_currency, band_period FROM jobs WHERE id = ?`).get("band-none-1");
  assert.deepEqual({ ...(row as object) }, { band_currency: null, band_period: null });
});

test("a read after the market changed keeps the band's own currency and labels it", () => {
  const ws = "ws-band-switch";
  insertJob(withBandUnit(role("band-switch-1", [80000, 110000]), getWorkspaceMarket(ws)), undefined, "draft", ws);
  assert.equal(getJob("band-switch-1", ws)?.bandCurrency, "CZK", "written in the default market");

  setDecisionConfig("market", { marketId: "de" }, ws, "team");
  const market = getWorkspaceMarket(ws);
  const job = getJob("band-switch-1", ws);
  assert.equal(job?.bandCurrency, "CZK", "changing the market relabels nothing");
  assert.deepEqual(job?.salaryBand, [80000, 110000], "and converts nothing");
  assert.equal(bandInOtherUnit(job, market), true, "the reader sees a band set in another unit");
  assert.equal(bandInOtherUnit(job, getWorkspaceMarket("ws-band-cz-peer")), false, "a cz reader sees its own unit");

  // Every decorating read agrees: the page read, the point read and the batch read.
  const listed = listJobsPage({}, ws).jobs.find((j) => j.id === "band-switch-1");
  assert.equal(listed?.bandCurrency, "CZK");
  assert.equal(getJobsByIds(["band-switch-1"], ws)[0]?.bandCurrency, "CZK");
});

test("a re-ingest after the switch re-stamps: the new figure is in the new market's unit", () => {
  const ws = "ws-band-switch";
  insertJob(withBandUnit(role("band-switch-1", [4000, 5000]), getWorkspaceMarket(ws)), undefined, "draft", ws);
  assert.equal(getJob("band-switch-1", ws)?.bandCurrency, "EUR");
});

test("the boot backfill stamps an unstamped band CZK/month, never the current market", () => {
  const db = ensureDb();
  const ws = "ws-band-legacy";
  setDecisionConfig("market", { marketId: "gb" }, ws, "team");
  // A row as it stood before the columns: a band, no unit (a corpus row and a team's row).
  const insert = db.prepare(
    `INSERT INTO jobs (id, title, salary_min, salary_max, payload_json, created_at, workspace_id, status)
     VALUES (?, 'Legacy', 70000, 90000, ?, '2026-01-01T00:00:00.000Z', ?, ?)`
  );
  insert.run("band-legacy-team", JSON.stringify({ id: "band-legacy-team", title: "Legacy", salaryBand: [70000, 90000] }), ws, "draft");
  insert.run("band-legacy-corpus", JSON.stringify({ id: "band-legacy-corpus", title: "Legacy", salaryBand: [70000, 90000] }), null, null);
  db.prepare(`INSERT INTO jobs (id, title, payload_json, created_at, workspace_id) VALUES ('band-legacy-bare', 'Bare', '{}', '2026-01-01', ?)`).run(ws);

  holder.__kpDb?.close();
  holder.__kpDb = undefined;
  const reopened = ensureDb();
  const read = (id: string) =>
    ({ ...(reopened.prepare(`SELECT band_currency, band_period FROM jobs WHERE id = ?`).get(id) as object) });
  assert.deepEqual(read("band-legacy-team"), { band_currency: "CZK", band_period: "month" }, "the team's CURRENT market (gb) is not a guess at the past");
  assert.deepEqual(read("band-legacy-corpus"), { band_currency: "CZK", band_period: "month" }, "the seed corpus is Czech by construction");
  assert.deepEqual(read("band-legacy-bare"), { band_currency: null, band_period: null }, "no band, no unit");
  assert.equal(bandInOtherUnit(getJob("band-legacy-team", ws), getWorkspaceMarket(ws)), true, "…and the gb reader labels it");
});

// ---- the writers ---------------------------------------------------------------------

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "node_modules" && name !== "landing") walk(p, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

// Callers that write no band, so there is no unit to stamp. Each says why.
const UNBANDED: Record<string, string> = {
  "app/_lib/interview-sim/instrument.ts": "the simulator's two fixture roles state no salary band",
};

test("every production writer stamps the band's unit before insertJob", () => {
  const offenders: string[] = [];
  let calls = 0;
  for (const file of walk(APP)) {
    const rel = path.relative(path.resolve(APP, ".."), file).split(path.sep).join("/");
    const src = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    for (const m of src.matchAll(/\binsertJob\(([^\n]*)/g)) {
      if (rel === "app/_lib/job-ingest.ts") continue; // the definition
      calls += 1;
      if (!m[1].startsWith("withBandUnit(") && !UNBANDED[rel]) offenders.push(`${rel}: insertJob(${m[1].slice(0, 60)}`);
    }
  }
  assert.ok(calls >= 5, `the scan found the writers (${calls})`);
  assert.deepEqual(offenders, [], "an unstamped band is read as CZK by the boot backfill: stamp it with withBandUnit");
});
