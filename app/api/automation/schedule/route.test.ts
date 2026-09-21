// The schedule route's PAYLOAD + WRITE contract after WP4a generalized it to the job
// registry (scheduler-jobs.ts).
//
// Two things are pinned. First, BACKWARD COMPATIBILITY: every field the GET shipped
// before — `schedule`/`runs` (the policy pass), `reminders`/`reminderRuns`,
// `scheduleScope`, `decisionsWorkspace`, the liveness trio — keeps its name and its
// meaning, and a legacy POST body (`enabled`/`intervalMinutes`/`tick` with no `job`,
// `remindersEnabled`) still writes what it always wrote. The sim dock and older
// panels read those names. Second, the REGISTRY: `jobs[]` lists every registered job
// with its schedule, runs and verification state, and a job that
// `requiresVerifiedRun` cannot be armed until the store holds one `ok` run for it.
//
// Drives the REAL handlers against an isolated throwaway DB (unit-db.ts stays the
// first project import) in open auth mode — no KP_OPERATOR_PASSWORD, so every caller
// is the operator and the authority gates are not what is under test here (they have
// their own files). `next/headers` is virtualized because it cannot run outside a Next
// request scope; `next/server` resolves to the shared shim.
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import type { NextRequest } from "next/server";

register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const VIRTUAL_HEADERS = "kp-test:next-headers-schedule";
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") return { url: VIRTUAL_HEADERS, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === VIRTUAL_HEADERS) {
      return {
        format: "module",
        shortCircuit: true,
        source: `
          export async function cookies() { return { get: () => undefined }; }
          export async function headers() { return new Headers(); }
          export async function draftMode() { return { isEnabled: false }; }
        `,
      };
    }
    return nextLoad(url, context);
  },
});

// Loaded AFTER the hooks — resolution hooks only affect later imports.
const { GET, POST } = await import("./route.ts");
const { recordRun } = await import("../../../_lib/scheduler-store.ts");
const { SCHEDULER_JOBS } = await import("../../../_lib/scheduler-jobs.ts");

after(() => cleanupUnitDb());

type Schedule = { name: string; enabled: boolean; intervalMinutes: number; lastRunAt: string | null };
type JobView = { name: string; labelKey: string; schedule: Schedule; runs: unknown[]; requiresVerifiedRun: boolean; verified: boolean };
type Payload = {
  schedule: Schedule;
  runs: unknown[];
  reminders: Schedule;
  reminderRuns: unknown[];
  jobs: JobView[];
  scheduleScope: string;
  decisionsWorkspace: string;
  liveness: unknown;
  livenessReason: unknown;
  lastTickAt: unknown;
  tick?: unknown;
  code?: string;
  error?: string;
};

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/automation/schedule", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.7" },
      body: JSON.stringify(body),
    }) as unknown as NextRequest
  );
const json = async (res: Response) => (await res.json()) as Payload;

// The legacy field set, as a SNAPSHOT: a removed or renamed key here is a broken
// consumer somewhere (SimControlDock, an older panel), so the list is spelled out.
const LEGACY_KEYS = ["schedule", "runs", "reminders", "reminderRuns", "scheduleScope", "decisionsWorkspace", "liveness", "livenessReason", "lastTickAt"];

test("GET keeps every legacy field AND adds jobs[] — one entry per registered job, in registry order", async () => {
  const res = await GET();
  assert.equal(res.status, 200);
  const body = await json(res);
  for (const key of LEGACY_KEYS) assert.ok(key in body, `legacy field ${key} must survive on the payload`);
  assert.deepEqual(Object.keys(body).sort(), [...LEGACY_KEYS, "jobs"].sort(), "the payload's key set is pinned: add a registry job, not a payload field");
  assert.equal(body.scheduleScope, "global");
  assert.equal(body.schedule.name, "policy_pass");
  assert.equal(body.schedule.enabled, false, "the policy pass is created OFF (no autostart in the test env)");
  assert.equal(body.reminders.name, "reminders");
  assert.equal(body.reminders.enabled, true, "the reminders row is created ON at its historical cadence");
  assert.equal(body.reminders.intervalMinutes, 1);

  assert.equal(body.jobs.length, SCHEDULER_JOBS.length);
  assert.deepEqual(
    body.jobs.map((j) => j.name),
    SCHEDULER_JOBS.map((j) => j.name),
    "jobs[] is the registry, in registry order"
  );
  assert.deepEqual(body.jobs.map((j) => j.name), ["policy_pass", "reminders", "jobseeker_scan"]);
  for (const job of body.jobs) {
    assert.equal(typeof job.labelKey, "string");
    assert.ok(Array.isArray(job.runs));
    assert.equal(typeof job.verified, "boolean");
  }
  // The legacy fields and the registry entries describe the SAME rows.
  assert.deepEqual(body.jobs[0].schedule, body.schedule);
  assert.deepEqual(body.jobs[1].schedule, body.reminders);

  const scan = body.jobs.find((j) => j.name === "jobseeker_scan")!;
  assert.equal(scan.schedule.enabled, false, "jobseeker_scan is registered disabled");
  assert.equal(scan.schedule.intervalMinutes, 720);
  assert.equal(scan.requiresVerifiedRun, true);
  assert.equal(scan.verified, false, "no run yet, so not verified");
});

test("a LEGACY POST body still flips the policy pass and the reminders job", async () => {
  let body = await json(await post({ enabled: true, intervalMinutes: 30 }));
  assert.equal(body.schedule.enabled, true, "`enabled` with no `job` means the policy pass");
  assert.equal(body.schedule.intervalMinutes, 30);
  assert.equal(body.jobs[0].schedule.enabled, true, "…and jobs[] sees the same row");
  assert.equal(body.reminders.enabled, true, "the reminders job was not touched");

  body = await json(await post({ remindersEnabled: false }));
  assert.equal(body.reminders.enabled, false, "`remindersEnabled` means { job: reminders, enabled }");
  assert.equal(body.jobs.find((j) => j.name === "reminders")!.schedule.enabled, false);
  assert.equal(body.schedule.enabled, true, "the policy pass was not touched");

  body = await json(await post({ enabled: false, remindersEnabled: true }));
  assert.equal(body.schedule.enabled, false);
  assert.equal(body.reminders.enabled, true);
});

test("the NEW POST shape names the job", async () => {
  let body = await json(await post({ job: "reminders", enabled: false, intervalMinutes: 5 }));
  assert.equal(body.reminders.enabled, false);
  assert.equal(body.reminders.intervalMinutes, 5);
  assert.equal(body.schedule.enabled, false, "naming reminders leaves the policy pass alone");
  body = await json(await post({ job: "reminders", enabled: true, intervalMinutes: 1 }));
  assert.equal(body.reminders.enabled, true);
  assert.equal(body.reminders.intervalMinutes, 1);
});

test("arming jobseeker_scan before a verified run is refused with 409 JOBSEEKER_SCAN_UNVERIFIED", async () => {
  const res = await post({ job: "jobseeker_scan", enabled: true });
  assert.equal(res.status, 409);
  const body = await json(res);
  assert.equal(body.code, "JOBSEEKER_SCAN_UNVERIFIED");
  // A `skipped` run (the WP4a placeholder handler) is NOT a verification.
  recordRun({ job: "jobseeker_scan", status: "skipped", summary: { skipped: "not_wired" }, startedAt: new Date().toISOString() });
  assert.equal((await post({ job: "jobseeker_scan", enabled: true })).status, 409, "a skipped run must not arm the crawler");
  // Nor is a failed one.
  recordRun({ job: "jobseeker_scan", status: "error", error: "boom", startedAt: new Date().toISOString() });
  assert.equal((await post({ job: "jobseeker_scan", enabled: true })).status, 409);
  // Disabling and re-timing an unverified job is fine — only ARMING is gated.
  const cfg = await post({ job: "jobseeker_scan", enabled: false, intervalMinutes: 60 });
  assert.equal(cfg.status, 200);
  assert.equal((await json(cfg)).jobs.find((j) => j.name === "jobseeker_scan")!.schedule.intervalMinutes, 60);
});

test("one ok run verifies the job, and it can then be armed", async () => {
  recordRun({ job: "jobseeker_scan", status: "ok", summary: { postings: 3 }, trigger: "manual", startedAt: new Date().toISOString() });
  const get = await json(await GET());
  assert.equal(get.jobs.find((j) => j.name === "jobseeker_scan")!.verified, true);
  const res = await post({ job: "jobseeker_scan", enabled: true });
  assert.equal(res.status, 200);
  const body = await json(res);
  const scan = body.jobs.find((j) => j.name === "jobseeker_scan")!;
  assert.equal(scan.schedule.enabled, true);
  assert.equal(scan.verified, true);
  assert.ok(scan.runs.length >= 1, "the job's own runs ride on its registry entry");
});

test("a job the registry does not carry, and a manual tick for a non-policy job, are refused with existing codes", async () => {
  const unknown = await post({ job: "price_reconcile", enabled: true });
  assert.equal(unknown.status, 400);
  assert.equal((await json(unknown)).code, "AUTOMATION_TASK_UNKNOWN");

  const tick = await post({ job: "reminders", tick: true });
  assert.equal(tick.status, 400);
  assert.equal((await json(tick)).code, "AUTOMATION_TASK_NOT_OFFERED", "Run now is the policy pass's door (tickScheduler)");
});

test("the malformed-interval refusal is unchanged", async () => {
  const res = await post({ intervalMinutes: "soon" });
  assert.equal(res.status, 400);
  assert.equal((await json(res)).code, "SCHEDULE_INTERVAL_INVALID");
});
