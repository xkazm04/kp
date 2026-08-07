import { z } from "zod";
import { roleBriefSchema, roleSpecSchema } from "./schemas.generated";

// The canonical TS role shapes — inferred from the GENERATED Zod schemas, whose
// source of truth is Python (pipeline/jobfit/devcase/models.py::RoleSpec and
// pipeline/jobfit/rolebrief.py::RoleBrief, via `python -m pipeline.jobfit.codegen`).
// This retires the two hand-copied, divergent RoleSpec declarations that lived in
// jd-build-run.ts and DevTypes.ts (idea-dcf2460d): change the Python model and
// `npm run typecheck` (schemas:gen) moves every TS consumer with it.
//
// Partial<> on purpose: TS consumers read roles from stored JSON blobs
// (jds.analysis_json.role, dev_cases.role_json) and client payloads where fields
// may predate the current schema — the generated schema itself is all-required
// because Pydantic defaults always serialize.
export type RoleSpec = Partial<z.infer<typeof roleSpecSchema>>;
export type RoleBrief = Partial<z.infer<typeof roleBriefSchema>>;

// Trust-boundary parse for an untrusted role payload (client-sent on
// POST /api/jds/save, Python-emitted on the design chain). Wrong-shaped input
// degrades to {} — every consumer already treats absent fields gracefully —
// instead of the previous unchecked `as RoleSpec` cast, which let a malformed
// field (e.g. mustHaves as a string) crash downstream `.map` calls.
export function parseRoleSpec(value: unknown): RoleSpec {
  const parsed = roleSpecSchema.partial().safeParse(value);
  return parsed.success ? parsed.data : {};
}
