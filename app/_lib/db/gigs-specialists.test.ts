// Behaviour of the gig specialist store on an isolated throwaway DB - unit-db.ts must be
// the first project import.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import type { GigArena, GigSpecialistSpec } from "../gigs/types.ts";
import { createGigSpecialist, findGigSpecialistForArena, getGigSpecialist, getGigSpecialistForGig, listGigPersonaSpecialists, listGigSpecialists } from "./gigs-specialists.ts";

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

test("a gig persona carries its gig id, is found per gig (newest first), and is never an arena candidate", () => {
  const ws = "ws-gig-specialists-persona";
  const niche = createGigSpecialist(ws, { hiredAgentId: "ha-n", name: "Niche", spec: spec("security", "web"), registry: "unavailable" });
  const first = createGigSpecialist(ws, { hiredAgentId: "ha-p1", name: "Persona 1", spec: spec("security", "web"), registry: "unavailable", gigId: "gig-1" });
  const second = createGigSpecialist(ws, { hiredAgentId: "ha-p2", name: "Persona 2", spec: spec("security", "web"), registry: "unavailable", gigId: "gig-1" });
  assert.equal(niche.gigId, null);
  assert.equal(first.gigId, "gig-1");
  assert.equal(getGigSpecialistForGig(ws, "gig-1")?.id, second.id, "a replaced hire: the newest row wins");
  assert.equal(getGigSpecialistForGig(ws, "gig-2"), null);
  assert.equal(getGigSpecialistForGig(OTHER, "gig-1"), null, "another workspace cannot read it");
  assert.deepEqual(listGigPersonaSpecialists(ws).map((s) => s.id), [first.id, second.id]);
  assert.equal(listGigPersonaSpecialists(OTHER).length, 0);
  assert.equal(findGigSpecialistForArena(ws, "security", "web")?.id, niche.id, "only the niche specialist is an arena candidate");
});
