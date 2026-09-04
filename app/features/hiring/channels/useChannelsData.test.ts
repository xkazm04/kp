// The two rules the Channels tab's data hook must not lose. Both are pure, so they
// are pinned here rather than through a rendered tab:
//
//   1. A failed load is NOT an empty channel. Every branch of `load` used to end in
//      `?? []` / `?? 0`, so an error body (a 500 from /api/jobs' seed check, a 401
//      after the session lapsed — both valid JSON, so neither reached the `.catch`)
//      settled the tab on a confident empty: "Off", "Nothing published", "Receivers 0",
//      and a first-run brief telling a recruiter with live receivers how to set one up.
//
//   2. "Waiting" counts the ENTRY column of the axis this workspace actually renders,
//      by role — not the stage literally named "Accepted". Intake files arrivals with
//      stageWithRole("entry", …) (cv-intake.ts), so a composed axis parked every
//      inbound application somewhere the tab's `=== "Accepted"` filter could not see.
import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import type { StageDef } from "@/app/_lib/pipeline-stages";
import type { PipelineEntryView } from "@/app/_lib/db/pipeline";
import { countWaitingAtEntry, listFromPayload } from "./useChannelsData";

const entry = (stage: string, status = "active"): PipelineEntryView =>
  ({ id: `e_${stage}_${status}_${Math.random()}`, stage, status }) as unknown as PipelineEntryView;

test("listFromPayload returns the list a successful body carries", () => {
  assert.deepEqual(listFromPayload<{ id: string }>({ jobs: [{ id: "j1" }] }, "jobs"), [{ id: "j1" }]);
  // A genuinely empty workspace is still an empty list — the honest zero survives.
  assert.deepEqual(listFromPayload({ webhooks: [] }, "webhooks"), []);
});

test("listFromPayload never turns an error body into an empty channel", () => {
  // What /api/jobs answers when the seed is corrupt, and what /api/channels/webhooks
  // answers when the session lapsed: valid JSON, no list, HTTP 4xx/5xx.
  assert.equal(listFromPayload({ error: "Job catalog is empty — seed failed to load." }, "jobs"), "failed");
  assert.equal(listFromPayload({ error: "Unauthorized" }, "webhooks"), "failed");
  // A non-2xx whose body we never parsed, and a route that answered the wrong shape.
  assert.equal(listFromPayload(null, "jobs"), "failed");
  assert.equal(listFromPayload(undefined, "entries"), "failed");
  assert.equal(listFromPayload({ jobs: null }, "jobs"), "failed");
  assert.equal(listFromPayload({ jobs: { 0: "not-an-array" } }, "jobs"), "failed");
});

test("countWaitingAtEntry counts the default axis's entry column, active only", () => {
  const entries = [entry("Accepted"), entry("Accepted"), entry("Accepted", "rejected"), entry("Screened")];
  assert.equal(countWaitingAtEntry(entries, undefined), 2);
});

test("countWaitingAtEntry follows a composed axis by ROLE, not by the name Accepted", () => {
  // A workspace that composed its own board in Settings → Hiring: the entry column is
  // "New applicants", and cv-intake files every inbound application there.
  const axis: StageDef[] = [
    { id: "New applicants", label: "New applicants", role: "entry" },
    { id: "Screened", label: "Screened", role: "screening" },
    { id: "Hired", label: "Hired", role: "terminal" },
  ];
  const entries = [entry("New applicants"), entry("New applicants"), entry("New applicants", "rejected"), entry("Screened")];
  assert.equal(countWaitingAtEntry(entries, axis), 2);
  // …and the stage that merely KEEPS the old name is not the entry column any more.
  assert.equal(countWaitingAtEntry([entry("Accepted")], axis), 0);
});

test("countWaitingAtEntry falls back to the shipped axis when the payload carries none", () => {
  assert.equal(countWaitingAtEntry([entry("Accepted")], []), 1);
});

// 3. The tab's two own fetches are ABORTED when it unmounts, and nothing settles state
//    after that. /api/jobs?limit=200 is ~201 KB: switching away mid-flight used to let
//    it run to completion and then write into a component React had torn down. A source
//    guard rather than a render test — the rule is about the shape of the effect, and
//    the unit runner has no DOM.
test("the data hook aborts its own in-flight fetches on unmount", () => {
  const src = readFileSync(new URL("./useChannelsData.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(src, /new AbortController\(\)/, "the mount effect must own a controller");
  assert.match(src, /return \(\) => ac\.abort\(\)/, "…and abort it in the cleanup");
  // Both fetches this hook owns carry the signal. sharedGetJson deliberately does NOT:
  // its request may be shared with another hook, so aborting it would cancel theirs.
  const signalled = src.match(/fetch\("\/api\/[^"]+", \{ signal \}\)/g) ?? [];
  assert.equal(signalled.length, 2, `both own fetches must pass the signal, found ${signalled.length}`);
  assert.doesNotMatch(src, /sharedGetJson<[^>]*>\([^)]*signal/, "a shared request must not be aborted on our unmount");
  // An aborted load settles nothing: every setter (and the failure mark) checks first.
  assert.ok((src.match(/signal\?\.aborted/g) ?? []).length >= 4, "every settle path must check the signal");
});
