// Workspace per arena, project per gig (project.ts) on an isolated DB, with injected Personas
// calls and a real folder under this run's temp KP_GIGS_ROOT. unit-db.ts first.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { getGig, upsertGigFromRaw } from "../db/gigs.ts";
import type { Gig } from "./types.ts";
import type { EnsurePersonasProjectResult, EnsurePersonasWorkspaceResult } from "./personas-places.ts";
import { GIG_ARENA_WORKSPACE_NAME, gigProjectName, prepareGigProject, type GigProjectDeps } from "./project.ts";
import { gigsRoot } from "./workdir.ts";

after(() => cleanupUnitDb());

const WS = "ws-gig-project";
let seq = 0;

function newGig(arena: Gig["arena"] = "freelance"): Gig {
  seq += 1;
  return upsertGigFromRaw(WS, {
    sourceId: "gsrc-p",
    arena,
    raw: {
      externalKey: `p-${seq}`,
      url: `https://example.test/p/${seq}`,
      title: `Landing page ${seq}`,
      org: null,
      reward: null,
      deadlineAt: null,
      postedAt: null,
      bodyText: "Build it.",
      bodyHtml: null,
      tags: [],
    },
    suspectReasons: [],
  }).gig;
}

type Calls = { workspaces: unknown[]; projects: unknown[] };

function personas(
  ws: EnsurePersonasWorkspaceResult,
  project: EnsurePersonasProjectResult | ((input: { rootPath: string; workspaceId: string | null }) => EnsurePersonasProjectResult)
): { deps: Partial<GigProjectDeps>; calls: Calls } {
  const calls: Calls = { workspaces: [], projects: [] };
  return {
    calls,
    deps: {
      ensureWorkspace: async (input) => {
        calls.workspaces.push(input);
        return ws;
      },
      ensureProject: async (input) => {
        calls.projects.push(input);
        return typeof project === "function" ? project(input) : project;
      },
    },
  };
}

const WS_OK: EnsurePersonasWorkspaceResult = { ok: true, id: "pws-free", name: "Freelance", groupTeamId: null, created: false };

test("arena workspace names", () => {
  assert.deepEqual(GIG_ARENA_WORKSPACE_NAME, {
    freelance: "Freelance",
    oss_bounty: "OSS bounties",
    competition: "Competitions",
    security: "Security programs",
  });
  assert.equal(gigProjectName({ title: "x".repeat(200), brief: null }), `Gig · ${"x".repeat(80)}`);
  assert.equal(gigProjectName({ title: "Listing", brief: { title: "Web · Better title" } as Gig["brief"] }), "Gig · Web · Better title");
});

test("linked: folder scaffolded, arena workspace ensured, project rooted at the folder, both recorded", async () => {
  const gig = newGig();
  const p = personas(WS_OK, (input) => ({ ok: true, id: "proj-1", name: "n", rootPath: input.rootPath, workspaceId: input.workspaceId, created: true }));
  const r = await prepareGigProject(WS, gig.id, p.deps);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.ok(r.workdir.startsWith(path.join(gigsRoot(), "freelance") + path.sep), r.workdir);
  assert.ok(existsSync(path.join(r.workdir, "GIG.md")) && existsSync(path.join(r.workdir, "NOTES.md")));
  assert.deepEqual(r.personas, { linked: true, projectId: "proj-1", workspaceId: "pws-free", created: true });
  assert.equal((p.calls.workspaces[0] as { name: string }).name, "Freelance");
  assert.deepEqual(p.calls.projects[0], {
    name: `Gig · ${gig.title}`,
    rootPath: r.workdir,
    workspaceId: "pws-free",
    description: gig.url,
    techStack: null,
  });
  const stored = getGig(WS, gig.id)!;
  assert.equal(stored.workdir, r.workdir);
  assert.equal(stored.personasProjectId, "proj-1");
  assert.equal(stored.updatedAt, gig.updatedAt, "the desk's sort key is not touched");

  // Idempotent: same folder, nothing new written, the same project.
  const again = await prepareGigProject(WS, gig.id, p.deps);
  assert.ok(again.ok && again.workdir === r.workdir && again.created.length === 0);
});

test("unpaired or unreachable Personas: the folder is still made and recorded; the project id is kept as it was", async () => {
  const gig = newGig();
  const linked = await prepareGigProject(WS, gig.id, personas(WS_OK, { ok: true, id: "proj-keep", name: "n", rootPath: "r", workspaceId: "pws-free", created: true }).deps);
  assert.ok(linked.ok);
  for (const reason of ["personas_unpaired", "personas_unreachable"] as const) {
    const p = personas({ ok: false, reason }, { ok: true, id: "never", name: "", rootPath: "", workspaceId: null, created: false });
    const r = await prepareGigProject(WS, gig.id, p.deps);
    assert.ok(r.ok, reason);
    if (!r.ok) continue;
    assert.deepEqual(r.personas, { linked: false, reason });
    assert.equal(p.calls.projects.length, 0, "no project call without a workspace");
    assert.equal(getGig(WS, gig.id)!.personasProjectId, "proj-keep", "silence is not evidence the project is gone");
  }

  const fresh = newGig();
  const r = await prepareGigProject(WS, fresh.id, personas({ ok: false, reason: "personas_unpaired" }, { ok: false, reason: "personas_unpaired" }).deps);
  assert.ok(r.ok);
  assert.ok(getGig(WS, fresh.id)!.workdir, "the workdir is recorded without Personas");
  assert.equal(getGig(WS, fresh.id)!.personasProjectId, null);
});

test("an older Personas (route missing) and a conflict: the folder is ready, the link says why; a conflict clears the stored id", async () => {
  const gig = newGig("oss_bounty");
  const old = await prepareGigProject(WS, gig.id, personas({ ok: false, reason: "personas_route_missing", status: 404 }, { ok: false, reason: "personas_route_missing" }).deps);
  assert.ok(old.ok && !old.personas.linked && old.personas.reason === "personas_route_missing");

  await prepareGigProject(WS, gig.id, personas(WS_OK, { ok: true, id: "proj-was", name: "", rootPath: "", workspaceId: "pws-free", created: true }).deps);
  assert.equal(getGig(WS, gig.id)!.personasProjectId, "proj-was");
  const conflict = await prepareGigProject(WS, gig.id, personas(WS_OK, { ok: false, reason: "personas_project_conflict", status: 409 }).deps);
  assert.ok(conflict.ok && !conflict.personas.linked && conflict.personas.reason === "personas_project_conflict");
  assert.equal(getGig(WS, gig.id)!.personasProjectId, null, "the stored id no longer names this folder's project");
});

test("a throwing injected Personas call is personas_unreachable; a folder failure is GIG_WORKSPACE_FAILED; an unknown gig is GIG_NOT_FOUND", async () => {
  const gig = newGig();
  const r = await prepareGigProject(WS, gig.id, {
    ensureWorkspace: async () => WS_OK,
    ensureProject: async () => {
      throw new Error("boom");
    },
  });
  assert.ok(r.ok && !r.personas.linked && r.personas.reason === "personas_unreachable");

  const failed = await prepareGigProject(WS, gig.id, { scaffold: () => ({ ok: false, reason: "workdir_outside_root", workdir: null }) });
  assert.deepEqual(failed, { ok: false, code: "GIG_WORKSPACE_FAILED", reason: "workdir_outside_root" });

  assert.deepEqual(await prepareGigProject(WS, "gig-nope", personas(WS_OK, { ok: false, reason: "personas_unpaired" }).deps), { ok: false, code: "GIG_NOT_FOUND" });
  assert.deepEqual(await prepareGigProject("ws-someone-else", gig.id, personas(WS_OK, { ok: false, reason: "personas_unpaired" }).deps), {
    ok: false,
    code: "GIG_NOT_FOUND",
  });
});
