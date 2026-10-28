// C5 — `?tab=integrations` moved into the Night Post's Connectors deck. The redirect keeps
// every param the arrival carried, above all the Google OAuth callback's `calendar=<code>`
// (app/api/calendar/google/callback/route.ts, which is NOT edited: its landing path is read
// from its source here), opens the deck on its calendar part, and the `g o` chord still
// exists and now leads to the new home.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CALENDAR_CALLBACK_STATUSES } from "../../_lib/calendar/callback-status.ts";
import { parseNightArrival } from "../hiring/channels/night/channelsNightNav.ts";
import { buildUrl, WORKSPACE_TAB_IDS } from "./tabs.ts";
import { deriveChords } from "./workspaceChords.ts";
import { TAB_REDIRECTS, redirectedTab, redirectParams, tabRedirectUrl } from "./tabRedirects.ts";

/** The callback's landing path, read from the route's own source (the route is not ours to edit). */
function callbackLanding(): string {
  const src = readFileSync(fileURLToPath(new URL("../../api/calendar/google/callback/route.ts", import.meta.url)), "utf8");
  const m = src.match(/const SETTINGS_PATH = "([^"]+)";/);
  assert.ok(m, "the callback still names its landing path");
  return m[1];
}

const query = (url: string) => new URLSearchParams(url.replace(/^\/\?/, ""));

test("every OAuth callback landing survives the redirect, and opens the deck on the calendar", () => {
  const landing = callbackLanding();
  assert.ok(landing.startsWith("/?tab=integrations&calendar="), landing);
  for (const code of CALENDAR_CALLBACK_STATUSES) {
    const arrived = `${landing}${encodeURIComponent(code)}`;
    const next = tabRedirectUrl(arrived.slice(2));
    assert.ok(next, code);
    const q = query(next);
    assert.equal(q.get("tab"), "channels", code);
    assert.equal(q.get("calendar"), code, `the outcome ${code} rides through untouched`);
    assert.equal(q.get("sec"), "connectors:calendar");
    // The workspace inbox then empties `tab` (buildUrl({ tab: null })): the outcome and the deck's
    // own inbox param are still there for the Night Post and the calendar panel to read.
    const settled = query(buildUrl({ tab: null }, next.slice(2)));
    assert.equal(settled.get("calendar"), code);
    assert.deepEqual(parseNightArrival(settled.get("sec"))?.at(-1), { level: 1, deck: "connectors", focus: "calendar" });
  }
});

test("a bare ?tab=integrations lands on the deck itself; other params are kept", () => {
  const q = query(tabRedirectUrl("tab=integrations&lang=cs") ?? "");
  assert.equal(q.get("tab"), "channels");
  assert.equal(q.get("sec"), "connectors");
  assert.equal(q.get("lang"), "cs");
  assert.deepEqual(parseNightArrival(q.get("sec"))?.at(-1), { level: 1, deck: "connectors", focus: null });
});

test("an arrival at a tab that did not move is not rewritten", () => {
  assert.equal(tabRedirectUrl("tab=decisions"), null);
  assert.equal(tabRedirectUrl("calendar=connected"), null);
  assert.equal(tabRedirectUrl(""), null);
  assert.equal(redirectedTab("pipeline"), "pipeline");
  assert.equal(redirectParams("schedule", ""), null);
});

test("the integrations chord still exists and a pick of it (chord or nav) opens the new home", () => {
  const chord = deriveChords().find((c) => c.id === "integrations");
  assert.deepEqual(chord?.keys, ["o"], "the chord is unchanged muscle memory");
  assert.equal(redirectedTab("integrations"), "channels");
  assert.deepEqual(redirectParams("integrations", ""), { sec: "connectors" });
});

test("redirect targets are live tabs, and a redirected id is still a live id (its links still compile)", () => {
  for (const [from, r] of Object.entries(TAB_REDIRECTS)) {
    assert.ok((WORKSPACE_TAB_IDS as readonly string[]).includes(from), from);
    assert.ok(r && (WORKSPACE_TAB_IDS as readonly string[]).includes(r.tab), `${from} -> ${r?.tab}`);
    assert.ok(r && !TAB_REDIRECTS[r.tab], "no redirect chains");
  }
});
