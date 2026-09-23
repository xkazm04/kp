// Challenge r03 platform-auth-api/B: the System strip's readiness rows.
//
// SpendEngineFacts printed /api/ops's `degradedReasons` verbatim - English server
// sentences with no next step, in every locale. The route now also sends coded
// `findings` (app/_lib/readiness.ts); toView() turns them into rows that name a catalog
// key and an action, and keeps the old strings as the floor: a code this client's
// catalog does not know (a newer server than the bundle) and a reason no finding covers
// (an older server) both still render their English sentence, never a blank row and
// never a raw key.
//
// unit-db.ts is imported only because the bijection check reads READINESS_CODES from
// the server module, which imports the DB layer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import "../../../../_lib/testing/unit-db.ts";
import { READINESS_CODES, type ReadinessFinding } from "../../../../_lib/readiness.ts";
import { isWorkspaceTabId } from "../../../shell/tabs.ts";
import { toView } from "./readinessFindings.ts";

type Catalog = { models: { system: { findings?: Record<string, { title?: string; fix?: string }> } } };
const LOCALES = ["en", "cs", "de", "fr"] as const;
const catalogs = Object.fromEntries(
  LOCALES.map((l) => [l, JSON.parse(readFileSync(path.join(process.cwd(), "messages", `${l}.json`), "utf8")) as Catalog])
) as Record<(typeof LOCALES)[number], Catalog>;
const enFindings = catalogs.en.models.system.findings ?? {};
const knows = (code: string) => typeof enFindings[code]?.title === "string";

const fault = (code: string, over: Partial<ReadinessFinding> = {}): ReadinessFinding =>
  ({ code, severity: "fault", params: {}, remedy: { kind: "host" }, reason: `${code} reason`, ...over }) as ReadinessFinding;
const warn = (code: string, over: Partial<ReadinessFinding> = {}): ReadinessFinding =>
  ({ code, severity: "warn", params: {}, remedy: { kind: "none" }, reason: `${code} reason`, ...over }) as ReadinessFinding;

test("faults sort before warns, and each row names its catalog key and an action", () => {
  const rows = toView(
    [
      warn("PUBLIC_ORIGIN_FALLBACK", { remedy: { kind: "env", vars: ["APP_BASE_URL"] } }),
      fault("DECISION_CONFIG_UNREADABLE", {
        params: { phase: "screening", scope: "team", workspaceId: "ws-x" },
        remedy: { kind: "door", tab: "decisions" },
      }),
      warn("SCHEDULER_STARTING"),
      fault("SCHEDULER_STALLED", { params: { lastTickAt: null } }),
    ],
    [],
    knows
  );
  assert.deepEqual(
    rows.map((r) => r.severity),
    ["fault", "fault", "warn", "warn"]
  );
  assert.deepEqual(
    rows.map((r) => r.code),
    ["DECISION_CONFIG_UNREADABLE", "SCHEDULER_STALLED", "PUBLIC_ORIGIN_FALLBACK", "SCHEDULER_STARTING"],
    "stable within a severity"
  );
  for (const r of rows) {
    assert.equal(r.catalogKey, `findings.${r.code}`, "resolved under models.system.findings.<CODE>");
    assert.equal(r.fallback, null);
    assert.ok(["tab", "env", "none"].includes(r.action.type));
  }
  const door = rows[0].action;
  assert.equal(door.type, "tab");
  assert.ok(door.type === "tab" && isWorkspaceTabId(door.tab), "the door is a real workspace tab");
  assert.deepEqual(rows[2].action, { type: "env", vars: ["APP_BASE_URL"] });
  assert.deepEqual(rows[1].action, { type: "none" }, "a host remedy has no in-app door; its fix text says so");
  assert.equal(rows[1].params.lastTickAt, "never", "a clock that never ticked is a select branch, not null");
  assert.equal(rows[0].role, "alert");
  assert.equal(rows[2].role, "status");
});

test("a code this client does not know falls back to its English reason", () => {
  const rows = toView([fault("FROM_A_NEWER_SERVER", { reason: "something new broke" })], [], knows);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].catalogKey, null, "never a raw key");
  assert.equal(rows[0].fallback, "something new broke", "never a blank row");
  assert.deepEqual(rows[0].action, { type: "none" });
});

test("an unknown code with no reason is dropped rather than rendered blank", () => {
  assert.deepEqual(toView([fault("FROM_A_NEWER_SERVER", { reason: "" })], [], knows), []);
});

test("a door to a tab that does not exist degrades to no action", () => {
  const rows = toView([fault("DECISION_CONFIG_UNREADABLE", { remedy: { kind: "door", tab: "nope" } as never })], [], knows);
  assert.deepEqual(rows[0].action, { type: "none" });
});

test("legacy reasons no finding covers still render (an older server sends no findings)", () => {
  const rows = toView(undefined, ["seed:jobs broken (/p)"], knows);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fallback, "seed:jobs broken (/p)");
  assert.equal(rows[0].severity, "fault");

  const covered = toView([warn("SCHEDULER_STARTING", { reason: "scheduler starting" })], ["scheduler starting"], knows);
  assert.equal(covered.length, 1, "a reason a finding already carries is not rendered twice");
});

test("garbage on the wire is ignored, not rendered", () => {
  const rows = toView([null, 42, { code: 7 }, "x"] as never, [], knows);
  assert.deepEqual(rows, []);
});

test("every readiness code has a title and a fix in all four catalogs, and nothing else lives there", () => {
  for (const locale of LOCALES) {
    const findings = catalogs[locale].models.system.findings ?? {};
    for (const code of READINESS_CODES) {
      assert.equal(typeof findings[code]?.title, "string", `${locale}: models.system.findings.${code}.title`);
      assert.equal(typeof findings[code]?.fix, "string", `${locale}: models.system.findings.${code}.fix`);
      assert.ok(!findings[code]!.title!.includes("—") && !findings[code]!.fix!.includes("—"), `${locale}: no em dash`);
    }
    assert.deepEqual(Object.keys(findings).sort(), [...READINESS_CODES].sort(), `${locale}: the key set IS the code set`);
  }
  for (const code of READINESS_CODES) {
    for (const locale of ["cs", "de", "fr"] as const) {
      assert.notEqual(
        catalogs[locale].models.system.findings?.[code]?.fix,
        enFindings[code]?.fix,
        `${locale}: ${code} is translated, not an English copy`
      );
    }
  }
});
