// Behaviour of the gig specialist store on an isolated throwaway DB - unit-db.ts must be
// the first project import.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import type { GigArena, GigSpecialistSpec } from "../gigs/types.ts";
import { createGigSpecialist, findGigSpecialistForArena, getGigSpecialist, listGigSpecialists } from "./gigs-specialists.ts";

after(() => cleanupUnitDb());

const WS = "ws-gig-specialists";
const OTHER = "ws-gig-specialists-other";

function spec(arena: GigArena, niche: string): GigSpecialistSpec {
  return {
    arena,
    niche,
    taxonomyFamily: "software_engineering",
    recipes: [{ slug: "web-app-auth-review", version: "1.2.0" }],
    exemplars: [],
    connectors: ["github"],
    budgetUsdPerAttempt: 2,
    promptVersion: "v1",
  };
}

test("create / get / list round-trip the spec", () => {
  const s = createGigSpecialist(WS, { hiredAgentId: "ha-1", name: "Auth reviewer", spec: spec("security", "web-app auth"), registry: "available" });
  assert.equal(s.hiredAgentId, "ha-1");
  assert.equal(s.registry, "available");
  assert.deepEqual(getGigSpecialist(WS, s.id)?.spec, spec("security", "web-app auth"));
  assert.ok(listGigSpecialists(WS).some((x) => x.id === s.id));
});

test("findGigSpecialistForArena: exact niche first (case/space-insensitive), else any in the arena, else null", () => {
  const ws = "ws-gig-specialists-find";
  const general = createGigSpecialist(ws, { hiredAgentId: "ha-a", name: "General", spec: spec("oss_bounty", "typescript"), registry: "unavailable" });
  const rust = createGigSpecialist(ws, { hiredAgentId: "ha-b", name: "Rust", spec: spec("oss_bounty", "Rust CLI"), registry: "available" });
  createGigSpecialist(ws, { hiredAgentId: "ha-c", name: "Kaggle", spec: spec("competition", "tabular"), registry: "available" });

  assert.equal(findGigSpecialistForArena(ws, "oss_bounty", "  rust cli ")?.id, rust.id);
  assert.equal(findGigSpecialistForArena(ws, "oss_bounty", "go")?.id, general.id, "no exact niche -> the oldest in the arena");
  assert.equal(findGigSpecialistForArena(ws, "oss_bounty", null)?.id, general.id);
  assert.equal(findGigSpecialistForArena(ws, "security", null), null);
  assert.equal(findGigSpecialistForArena(OTHER, "oss_bounty", "rust cli"), null);
});

test("another workspace cannot read a specialist", () => {
  const s = createGigSpecialist(WS, { hiredAgentId: "ha-2", name: "X", spec: spec("freelance", "copy"), registry: "available" });
  assert.equal(getGigSpecialist(OTHER, s.id), null);
  assert.equal(listGigSpecialists(OTHER).length, 0);
});
