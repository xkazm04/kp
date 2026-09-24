import type { GigArena, GigSpecialist, GigSpecialistSpec } from "../gigs/types";
import { randomId } from "../random-id";
import { ensureDb, safeRowParse } from "./core";

// Gig specialists (app/_lib/gigs/types.ts): a hired_agents roster row (the Personas
// persona) plus the spec that makes it a specialist - arena, niche, adopted recipes,
// exemplars and a budget per attempt.
//
// Tenancy: every statement binds `workspace_id = ?`, point reads included
// (gigs-specialists-tenancy.test.ts). No carve-out, and no tenant default.

type GigSpecialistRow = {
  id: string;
  workspace_id: string;
  hired_agent_id: string;
  name: string;
  spec_json: string;
  registry: string;
  created_at: string;
  updated_at: string;
};

/** Parsed spec, or null when the stored JSON is unreadable or not an object with an
 *  arena - such a row is skipped by the readers below rather than guessed into shape. */
function readSpec(row: GigSpecialistRow): GigSpecialistSpec | null {
  const spec = safeRowParse<GigSpecialistSpec>(row.spec_json, "gigSpecialist.spec", row.id);
  return spec && typeof spec === "object" && typeof spec.arena === "string" ? spec : null;
}

function gigSpecialistFromRow(row: GigSpecialistRow, spec: GigSpecialistSpec): GigSpecialist {
  return {
    id: row.id,
    hiredAgentId: row.hired_agent_id,
    name: row.name,
    spec,
    registry: row.registry === "available" ? "available" : "unavailable",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowsToSpecialists(rows: GigSpecialistRow[]): GigSpecialist[] {
  const out: GigSpecialist[] = [];
  for (const row of rows) {
    const spec = readSpec(row);
    if (spec) out.push(gigSpecialistFromRow(row, spec));
  }
  return out;
}

export type CreateGigSpecialistInput = {
  hiredAgentId: string;
  name: string;
  spec: GigSpecialistSpec;
  registry: GigSpecialist["registry"];
};

export function createGigSpecialist(workspaceId: string, input: CreateGigSpecialistInput): GigSpecialist {
  const d = ensureDb();
  const id = randomId("gspec");
  const now = new Date().toISOString();
  d.prepare(
    `INSERT INTO gig_specialists (id, workspace_id, hired_agent_id, name, spec_json, registry, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    workspaceId,
    input.hiredAgentId,
    input.name.trim().slice(0, 200) || "Specialist",
    JSON.stringify(input.spec),
    input.registry === "available" ? "available" : "unavailable",
    now,
    now
  );
  const created = getGigSpecialist(workspaceId, id);
  if (!created) throw new Error(`gig specialist ${id} was not readable after its insert`);
  return created;
}

export function getGigSpecialist(workspaceId: string, id: string): GigSpecialist | null {
  const row = ensureDb()
    .prepare(`SELECT * FROM gig_specialists WHERE id = ? AND workspace_id = ?`)
    .get(id, workspaceId) as GigSpecialistRow | undefined;
  if (!row) return null;
  const spec = readSpec(row);
  return spec ? gigSpecialistFromRow(row, spec) : null;
}

export function listGigSpecialists(workspaceId: string): GigSpecialist[] {
  const rows = ensureDb()
    .prepare(`SELECT * FROM gig_specialists WHERE workspace_id = ? ORDER BY created_at ASC, rowid ASC`)
    .all(workspaceId) as GigSpecialistRow[];
  return rowsToSpecialists(rows);
}

function normalizeNiche(niche: string | null | undefined): string {
  return (niche ?? "").trim().toLowerCase();
}

/** The specialist a gig in `arena` should go to: an exact niche match first (trimmed,
 *  case-insensitive), else any specialist in the arena; the oldest wins a tie so the
 *  choice is stable. Null when the arena has no specialist. The arena lives in spec_json,
 *  so the filter runs over the workspace's (small) roster rather than in SQL. */
export function findGigSpecialistForArena(
  workspaceId: string,
  arena: GigArena,
  niche: string | null
): GigSpecialist | null {
  const inArena = listGigSpecialists(workspaceId).filter((s) => s.spec.arena === arena);
  const wanted = normalizeNiche(niche);
  if (wanted) {
    const exact = inArena.find((s) => normalizeNiche(s.spec.niche) === wanted);
    if (exact) return exact;
  }
  return inArena[0] ?? null;
}
