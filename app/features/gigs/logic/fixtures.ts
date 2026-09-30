// Fixture builders shared by the gigs logic tests (*.test.ts beside this file). Not a
// suite: node --test only runs *.test.ts.
import type { Gig, GigAttempt, GigAttemptStatus, GigKpiCell, GigStatus } from "@/app/_lib/gigs/types.ts";
import type { SpecialistRow } from "./wire.ts";

export const NOW = new Date("2026-09-24T12:00:00.000Z");
export const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();

export function gig(id: string, status: GigStatus, p: Partial<Gig> = {}): Gig {
  return {
    id,
    sourceId: null,
    arena: "freelance",
    externalKey: id,
    url: `https://example.test/${id}`,
    title: `Gig ${id}`,
    org: null,
    reward: null,
    deadlineAt: null,
    postedAt: null,
    bodyText: "body",
    tags: [],
    niche: null,
    status,
    suspectReasons: [],
    specialistId: null,
    qualification: null,
    brief: null,
    workdir: null,
    personasProjectId: null,
    withdrawReason: null,
    report: null,
    sourceState: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...p,
  };
}

export function att(id: string, gigId: string, status: GigAttemptStatus, p: Partial<GigAttempt> = {}): GigAttempt {
  return {
    id,
    gigId,
    specialistId: "s1",
    executionId: null,
    status,
    deliverable: null,
    fallbackReason: null,
    costUsd: null,
    review: null,
    revisionNote: null,
    sentAt: null,
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
    ...p,
  };
}

export function spec(id: string, niche: string, status: string | null, createdAt = "2026-09-20T00:00:00.000Z", arena: Gig["arena"] = "freelance"): SpecialistRow {
  return {
    id,
    hiredAgentId: `agent-${id}`,
    gigId: null,
    name: `Specialist ${id}`,
    spec: { arena, niche, taxonomyFamily: "x", recipes: [], exemplars: [], connectors: [], budgetUsdPerAttempt: 3, promptVersion: "v1" },
    registry: "available",
    createdAt,
    updatedAt: createdAt,
    hire: status === null ? null : { id: `h-${id}`, status, personaId: null, personaName: null, requestId: null, updatedAt: createdAt, lastReportAt: null },
  } as unknown as SpecialistRow;
}

export const cell = (p: Partial<GigKpiCell>): GigKpiCell => ({ resolved: 0, accepted: 0, rate: null, pending: 0, costPerAcceptedUsd: null, costUnreported: 0, smallSample: true, ...p });
