// Pins the demo screening invariant (idea-a5ba2302).
//
// SIM_SCREEN_POLICY single-sources two numbers that live in different files at
// runtime: the screen wave's reject ceiling (screenWaveOverride.maxMatchToReject,
// sent by SimulationProvider's screen step) and the scripted inbound applicant's
// score floor (inboundScoreFloor, used by /api/sim/inbound, which scores at
// `floor + charCode % 10`). The demo's headline promise — "follow THIS candidate
// to Hired" — depends on the relation between them: if the floor ever drops to or
// below the reject ceiling, the careers-page applicant can be auto-rejected
// mid-demo and the walk to Hired breaks in front of an audience, with nothing
// catching it. A module-load guard in constants.ts already fails fast at import;
// this test makes the same invariant a checkable CI assertion against the REAL
// exported constant (not a copy — a copy could never catch the module drifting),
// so a future tweak to either number is caught the moment tests run.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// This file loads the REAL modules (constants.ts, and the pure decision-config
// schema the screening wave resolves its floor through) rather than
// reimplementing their numbers — a copy could never catch the module drifting.
// Those specifiers are extensionless / "@/"-aliased, exactly how Next/tsc
// resolve, but the bare `node --test` runner won't auto-append .ts. Install a
// minimal resolve hook. Scoped to this file's process (node --test isolates
// files); resolves "@/" and relative specifiers to an absolute URL, then appends
// .ts when the extensionless target file exists.
const ROOT = new URL("../../../../", import.meta.url).href; // repo root (app/features/shell/simulation/ -> ../../../../)
registerHooks({
  resolve(specifier, context, nextResolve) {
    let spec = specifier;
    if (spec.startsWith("@/")) spec = new URL(spec.slice(2), ROOT).href; // tsconfig "@/*"
    else if ((spec.startsWith("./") || spec.startsWith("../")) && context.parentURL) {
      spec = new URL(spec, context.parentURL).href; // relative -> absolute file: URL
    }
    if (spec.startsWith("file:") && !/\.[a-z0-9]+$/i.test(spec) && existsSync(fileURLToPath(spec + ".ts"))) {
      spec += ".ts"; // extensionless local import, e.g. "./simCompanyTemplate"
    }
    return nextResolve(spec, context);
  },
});

const { SIM_ROLE, SIM_SCREEN_POLICY } = await import("./constants.ts");
// The REAL floor resolver the screening wave calls per candidate. Pure and
// DB-free by design (see its header), so it loads under `node --test`.
const { effectiveFloor } = await import("@/app/_lib/decision-config-schema");

test("inbound score floor strictly exceeds the screen reject ceiling", () => {
  // The scripted applicant scores in [floor, floor + 9]; its WORST case is the
  // floor itself, so the floor must clear the reject ceiling for the applicant to
  // survive screening on every run (screen-wave rejects when score < ceiling).
  const floor = SIM_SCREEN_POLICY.inboundScoreFloor;
  const ceiling = SIM_SCREEN_POLICY.screenWaveOverride.maxMatchToReject;
  assert.ok(
    floor > ceiling,
    `inbound score floor (${floor}) must stay strictly above the screen reject ceiling (${ceiling}), ` +
      `or the scripted careers-page applicant is auto-rejected mid-demo.`
  );
});

test("the whole inbound score band sits at or above the reject ceiling", () => {
  // Belt-and-suspenders on the band, not just the floor: every score the inbound
  // route can produce (floor + 0..9) must be a valid 0-100 match AND never land
  // below the reject ceiling, so no charCode remainder can sneak the applicant
  // under the bar.
  const floor = SIM_SCREEN_POLICY.inboundScoreFloor;
  const ceiling = SIM_SCREEN_POLICY.screenWaveOverride.maxMatchToReject;
  for (let r = 0; r <= 9; r++) {
    const score = floor + r;
    assert.ok(score >= ceiling, `inbound score ${score} (floor+${r}) drops below the reject ceiling ${ceiling}`);
    assert.ok(score >= 0 && score <= 100, `inbound score ${score} (floor+${r}) is not a valid 0-100 match`);
  }
});

test("the override pins the EFFECTIVE floor, so a workspace's per-family floor can't hijack the demo", () => {
  // The two assertions above pin maxMatchToReject — but maxMatchToReject is only
  // the floor actually applied when no per-family override exists. runScreenWave
  // merges per TOP-LEVEL field (`{ ...savedConfig, ...override }`) and then
  // resolves the floor per candidate via effectiveFloor(cfg, entry.roleFamily),
  // which prefers cfg.familyFloors[family]. The demo's job (and the inbound
  // entry it mints) carry SIM_ROLE.roleFamily, so a workspace that applied a
  // calibrated threshold to that family kept it through the override and the
  // invariant above was silently bypassed. Exercised against the REAL resolver
  // and the REAL merge, with a hostile saved config.
  const hostileSaved = {
    autoRejectEnabled: true,
    rejectBottomPercent: 20,
    maxMatchToReject: 45,
    familyFloors: { [SIM_ROLE.roleFamily]: 90 },
  };
  const cfg = { ...hostileSaved, ...SIM_SCREEN_POLICY.screenWaveOverride };
  const applied = effectiveFloor(cfg, SIM_ROLE.roleFamily);
  assert.equal(
    applied,
    SIM_SCREEN_POLICY.screenWaveOverride.maxMatchToReject,
    `the demo's screen-wave override must neutralise a saved familyFloors entry for ` +
      `"${SIM_ROLE.roleFamily}" (effective floor was ${applied}, expected the demo ceiling ` +
      `${SIM_SCREEN_POLICY.screenWaveOverride.maxMatchToReject})`
  );
  assert.ok(
    SIM_SCREEN_POLICY.inboundScoreFloor > applied,
    `the scripted applicant (score floor ${SIM_SCREEN_POLICY.inboundScoreFloor}) is auto-rejected ` +
      `mid-demo against an effective floor of ${applied}`
  );
});
