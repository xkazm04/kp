// Cohort Studio (Analyze v2): who is in the comparison, and what the run would spend.
//
// GET /api/analyze/cohort/proposal builds a CohortProposal for one JD; POST
// /api/analyze/cohort re-resolves the caller's chosen members through the SAME resolver,
// so a member the proposal could not offer can never be started either.
//
// Membership rules, in order (docs/features/candidates/README.md § Cohort Studio):
//   1. applicant — every pipeline entry filed under the JD's job (`jd-<slug>`) whose
//      candidate resolves (resolveCandidatePoolEntry) to a source WITH CV TEXT. An entry
//      with no candidate id, an agent row, an erased person or a profile with no source
//      analysis is skipped (and logged with a count — the wire contract has no field).
//   2. matched — a top-up from the workspace pool ranked against the job by the
//      deterministic recruiter_cli ranker (KO-passed rows only, in rank order), excluding
//      anyone already in, until COHORT_CAP.
//   leftOut counts the eligible candidates of each rule the cap excluded.
//
// A member is identified by WHERE its CV comes from: an analysis slug, or
// `profile:<id>` for a profile (whose CV is its source analysis). Two members that are
// the same CV (`sameCv`: same cv_hash when both carry one, else the same source row or
// the same candidate label) collapse to the first.
//
// REUSE: a member is `reusable` when an analysis of the same CV is already filed against
// THIS JD — cv_hash equality when both sides carry a hash, otherwise the member's own
// source slug or an exact candidate-label match. The run then reuses it and spends
// nothing. A reused analysis keeps the language and blind setting it was made with.
//
// Never on the wire: payload_json, the CV text, cv_hash.

import { COHORT_CAP, MEMBERSHIPS, type CohortProposal, type MemberSource, type Membership, type ProposalMember } from "../features/tools/analyze/cohort/cohortTypes";
import type { CandidatePool } from "./candidate-pool";
import type { JobRecord } from "./db/core";
import {
  listAnalysisCohortCvFacts,
  listAnalysisCohortProfileFacts,
  type AnalysisCohortCvFact,
  type AnalysisCohortProfileFact,
  type AnalysisCohortReuseRow,
} from "./db/analysis-cohorts";
import { getJob, jobVisibleToWorkspace, loadJd, type JdBuildIntent } from "./db/jobs";
import { candidateLabelWithholdsPii } from "./db/pipeline";
import { getOrganization } from "./db/organizations";
import { getWorkspaceOrgId } from "./db/workspaces";

export const PROFILE_MEMBER_PREFIX = "profile:";

/** The member id for a CV source. */
export function memberIdForSource(source: MemberSource): string {
  return source.kind === "profile" ? `${PROFILE_MEMBER_PREFIX}${source.id}` : source.slug;
}

/** The CV source a member id names (no store read: the shape only). */
export function sourceForMemberId(memberId: string): MemberSource | null {
  const id = memberId.trim();
  if (!id) return null;
  if (id.startsWith(PROFILE_MEMBER_PREFIX)) {
    const pid = id.slice(PROFILE_MEMBER_PREFIX.length).trim();
    return pid ? { kind: "profile", id: pid } : null;
  }
  return { kind: "analysis", slug: id };
}

/** The wire name: candidate.name, else the label without its " → <role>" suffix. The raw
 *  label stays the MATCHING key (reuse rule, History, erasure). */
export function displayMemberLabel(candidateName: string | null | undefined, label: string): string {
  const name = (candidateName ?? "").trim();
  if (name) return name;
  const bare = label.split(/\s+(?:→|->)\s+/)[0]?.trim();
  return bare || label.trim();
}

/** Distinct names within one set (seeded CVs share names): a collision falls back to the
 *  bare stored label, then gets " (n)". */
export function uniqueDisplayLabels(entries: ReadonlyArray<{ displayLabel: string; label: string }>): string[] {
  const count = (xs: string[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>());
  const first = entries.map((e) => e.displayLabel);
  const firstCounts = count(first);
  const second = entries.map((e, i) => ((firstCounts.get(first[i]) ?? 0) > 1 ? displayMemberLabel(null, e.label) : first[i]));
  const secondCounts = count(second);
  const seen = new Map<string, number>();
  return second.map((l) => {
    if ((secondCounts.get(l) ?? 0) < 2) return l;
    const n = (seen.get(l) ?? 0) + 1;
    seen.set(l, n);
    return n === 1 ? l : `${l} (${n})`;
  });
}

/** One member's resolved CV: where it lives and who it is. `cvSlug` is the analysis row
 *  holding the CV text (the source itself, or a profile's source analysis). */
export type ResolvedCohortSource = {
  memberId: string;
  source: MemberSource;
  /** The stored candidate label — the MATCHING key (reuse rule, History). */
  label: string;
  /** What the wire shows (displayMemberLabel). */
  displayLabel: string;
  roleFamily: string | null;
  seniority: string | null;
  cvSlug: string;
  cvHash: string | null;
};

export type SourceReaders = {
  cvFacts: (slugs: readonly string[], workspaceId: string) => Map<string, AnalysisCohortCvFact>;
  profileFacts: (ids: readonly string[], workspaceId: string) => Map<string, AnalysisCohortProfileFact>;
  /** candidateLabelWithholdsPii: an expired-consent or anonymized person is not re-processed. */
  withholdsPii: (label: string, workspaceId: string) => boolean;
};

/** Resolve member ids to CV sources inside the workspace. A member that does not resolve
 *  to a CV with text (unknown id, foreign workspace, erased, profile without lineage, PII
 *  withheld) maps to null. */
export function resolveCohortSources(memberIds: readonly string[], workspaceId: string, r: SourceReaders): Map<string, ResolvedCohortSource | null> {
  const sources = memberIds.map((id) => [id, sourceForMemberId(id)] as const);
  const profileIds = sources.flatMap(([, s]) => (s?.kind === "profile" ? [s.id] : []));
  const profiles = r.profileFacts(profileIds, workspaceId);
  const slugs = sources.flatMap(([, s]) =>
    s?.kind === "analysis" ? [s.slug] : s?.kind === "profile" ? [profiles.get(s.id)?.sourceAnalysisSlug ?? ""] : []
  );
  const facts = r.cvFacts(slugs.filter(Boolean), workspaceId);
  const out = new Map<string, ResolvedCohortSource | null>();
  for (const [memberId, source] of sources) {
    if (!source) {
      out.set(memberId, null);
      continue;
    }
    let resolved: ResolvedCohortSource | null = null;
    if (source.kind === "analysis") {
      const f = facts.get(source.slug);
      if (f?.hasCvText) {
        resolved = {
          memberId,
          source,
          label: f.label,
          displayLabel: displayMemberLabel(f.candidateName, f.label),
          roleFamily: f.roleFamily,
          seniority: f.seniority,
          cvSlug: f.slug,
          cvHash: f.cvHash,
        };
      }
    } else {
      const p = profiles.get(source.id);
      const f = p?.sourceAnalysisSlug ? facts.get(p.sourceAnalysisSlug) : undefined;
      if (p && f?.hasCvText) {
        resolved = {
          memberId,
          source,
          label: p.label,
          displayLabel: displayMemberLabel(f.candidateName, p.label),
          roleFamily: p.roleFamily ?? f.roleFamily,
          seniority: f.seniority,
          cvSlug: f.slug,
          cvHash: f.cvHash ?? p.sourceCvHash,
        };
      }
    }
    if (resolved && r.withholdsPii(resolved.label, workspaceId)) resolved = null;
    out.set(memberId, resolved);
  }
  return out;
}

/** Are two sources the same CV? The reuse rule's own test, so "already in the cohort"
 *  and "already analysed against this JD" can never disagree: cv_hash equality when both
 *  carry one, otherwise the same CV row or the same candidate label. (A seeded or legacy
 *  analysis has no cv_hash, and a re-run against the JD is a NEW row: without the label
 *  fallback the same person entered twice — once as an applicant, once as the earlier
 *  run the pool ranked.) */
export function sameCv(a: Pick<ResolvedCohortSource, "cvHash" | "cvSlug" | "label">, b: Pick<ResolvedCohortSource, "cvHash" | "cvSlug" | "label">): boolean {
  if (a.cvHash && b.cvHash) return a.cvHash === b.cvHash;
  return a.cvSlug === b.cvSlug || a.label.trim().toLowerCase() === b.label.trim().toLowerCase();
}

/** The reuse rule (see the header): the newest analysis of this CV already filed against
 *  this JD, or null. `rows` are that JD's analyses, newest first. */
export function findReusableAnalysis(cv: Pick<ResolvedCohortSource, "cvSlug" | "cvHash" | "label">, rows: readonly AnalysisCohortReuseRow[]): string | null {
  for (const row of rows) {
    if (cv.cvHash && row.cvHash) {
      if (cv.cvHash === row.cvHash) return row.slug;
      continue;
    }
    if (row.slug === cv.cvSlug || row.label.trim() === cv.label.trim()) return row.slug;
  }
  return null;
}

/** The company context the analysis CLI receives: the organisation, the job's company and
 *  the JD build intent's company, de-duplicated; null when none of them says anything. */
export function composeCompanyText(
  org: { name: string; domain: string | null } | null,
  jobCompany: string | null | undefined,
  intentCompany: string | null | undefined
): string | null {
  const parts: string[] = [];
  const seen = new Set<string>();
  const add = (text: string | null | undefined) => {
    const t = (text ?? "").trim();
    if (!t || seen.has(t.toLowerCase())) return;
    seen.add(t.toLowerCase());
    parts.push(t);
  };
  if (org?.name?.trim()) {
    seen.add(org.name.trim().toLowerCase());
    parts.push(org.domain?.trim() ? `${org.name.trim()} (${org.domain.trim()})` : org.name.trim());
  }
  add(jobCompany);
  add(intentCompany);
  return parts.length ? parts.join("\n") : null;
}

/** The build intent's company, read defensively off the JD row's JSON. */
export function intentCompanyOf(buildInputJson: string | null | undefined): string | null {
  if (!buildInputJson) return null;
  try {
    const intent = JSON.parse(buildInputJson) as JdBuildIntent | null;
    return typeof intent?.company === "string" && intent.company.trim() ? intent.company.trim() : null;
  } catch {
    return null; // a corrupt intent says nothing about the company; the other sources still do
  }
}

// ---- the proposal ------------------------------------------------------------------

export type RankedRow = { candidateId?: unknown; koPassed?: unknown; result?: { total?: unknown } };

export type ProposalDeps = SourceReaders & {
  loadJd: (slug: string, workspaceId: string) => { slug: string; title: string; build_input_json?: string | null } | null;
  /** The JD's ingested job, visibility-checked; null when the JD was never ingested. */
  getJob: (jobId: string, workspaceId: string) => JobRecord | null;
  org: (workspaceId: string) => { name: string; domain: string | null } | null;
  listApplicants: (jobId: string, workspaceId: string) => Array<{ candidateId: string | null; candidateLabel: string }>;
  /** resolveCandidatePoolEntry !== null (it also refuses the reserved `agent-` ids). */
  poolEntryExists: (candidateId: string, label: string, workspaceId: string) => boolean;
  buildPool: (workspaceId: string) => CandidatePool;
  rankPool: (jobId: string, pool: CandidatePool["entries"], job: JobRecord) => Promise<{ candidates?: RankedRow[] }>;
  reuseRows: (jdSlug: string, workspaceId: string) => AnalysisCohortReuseRow[];
};

export type ProposalContext = { jdTitle: string; companyText: string | null; orgName: string | null; job: JobRecord | null };

/** The JD-level facts the proposal and the run share. Null = unknown/foreign JD. */
export function cohortJdContext(jdSlug: string, workspaceId: string, deps: Pick<ProposalDeps, "loadJd" | "getJob" | "org">): ProposalContext | null {
  const jd = deps.loadJd(jdSlug, workspaceId);
  if (!jd) return null;
  const job = deps.getJob(`jd-${jdSlug}`, workspaceId);
  const org = deps.org(workspaceId);
  return {
    jdTitle: jd.title,
    companyText: composeCompanyText(org, job?.company ?? null, intentCompanyOf(jd.build_input_json)),
    orgName: org?.name?.trim() || null,
    job,
  };
}

/** Classify a pool/pipeline candidate id: a profile id when one exists, else an analysis slug. */
function sourceForCandidateId(candidateId: string, profiles: Map<string, AnalysisCohortProfileFact>): MemberSource {
  return profiles.has(candidateId) ? { kind: "profile", id: candidateId } : { kind: "analysis", slug: candidateId };
}

export async function buildCohortProposal(jdSlug: string, workspaceId: string, deps: ProposalDeps): Promise<CohortProposal | null> {
  const ctx = cohortJdContext(jdSlug, workspaceId, deps);
  if (!ctx) return null;
  const jobId = `jd-${jdSlug}`;

  // (1) applicants, in filing order.
  const entries = ctx.job ? deps.listApplicants(jobId, workspaceId) : [];
  const applicantIds = entries.flatMap((e) =>
    e.candidateId && deps.poolEntryExists(e.candidateId, e.candidateLabel, workspaceId) ? [e.candidateId] : []
  );

  // (2) the ranked pool (deterministic; keyless works). No job, no ranking: an
  // un-ingested JD offers its applicants (none) and no top-up.
  const pool = ctx.job ? deps.buildPool(workspaceId) : { entries: [], truncated: false };
  const ranked = ctx.job && pool.entries.length > 0 ? (await deps.rankPool(jobId, pool.entries, ctx.job)).candidates ?? [] : [];
  const scoreById = new Map<string, number>();
  const eligibleIds: string[] = [];
  for (const row of ranked) {
    const id = typeof row.candidateId === "string" ? row.candidateId : null;
    const total = typeof row.result?.total === "number" ? row.result.total : null;
    if (!id) continue;
    if (total !== null) scoreById.set(id, total);
    if (row.koPassed === true) eligibleIds.push(id);
  }

  const profiles = deps.profileFacts([...applicantIds, ...eligibleIds], workspaceId);
  const toMemberId = (cid: string) => memberIdForSource(sourceForCandidateId(cid, profiles));
  const applicantMembers = applicantIds.map(toMemberId);
  const matchedMembers = eligibleIds.map(toMemberId);
  const resolved = resolveCohortSources([...applicantMembers, ...matchedMembers], workspaceId, deps);
  const reuse = deps.reuseRows(jdSlug, workspaceId);

  const members: ProposalMember[] = [];
  const rawLabelById = new Map<string, string>();
  const seen: ResolvedCohortSource[] = [];
  const leftOut = { applicants: 0, matched: 0 };
  let skipped = 0;
  const take = (memberId: string, candidateId: string, membership: Membership) => {
    const r = resolved.get(memberId);
    if (!r) {
      skipped += 1;
      return;
    }
    if (seen.some((s) => sameCv(s, r))) return;
    seen.push(r);
    if (members.length >= COHORT_CAP) {
      if (membership === "applicant") leftOut.applicants += 1;
      else leftOut.matched += 1;
      return;
    }
    rawLabelById.set(memberId, r.label);
    members.push({
      memberId,
      label: r.displayLabel,
      source: r.source,
      membership,
      roleFamily: r.roleFamily,
      seniority: r.seniority,
      matchScore: scoreById.get(candidateId) ?? null,
      reusable: findReusableAnalysis(r, reuse) !== null,
    });
  };
  applicantIds.forEach((cid, i) => take(applicantMembers[i], cid, "applicant"));
  eligibleIds.forEach((cid, i) => take(matchedMembers[i], cid, "matched"));
  const shown = uniqueDisplayLabels(members.map((m) => ({ displayLabel: m.label, label: rawLabelById.get(m.memberId) ?? m.label })));
  members.forEach((m, i) => (m.label = shown[i]));
  if (skipped > 0) console.info(`[analyze-cohort] proposal for "${jdSlug}" skipped ${skipped} candidate(s) with no readable CV`);

  return {
    jdSlug,
    jdTitle: ctx.jdTitle,
    companyText: ctx.companyText,
    orgName: ctx.orgName,
    members,
    leftOut,
    cap: COHORT_CAP,
    freshCount: members.filter((m) => !m.reusable).length,
  };
}

// ---- the POST body -------------------------------------------------------------------

export type ParsedRunRequest = {
  jdSlug: string;
  members: Array<{ memberId: string; membership: Membership }>;
  blind: boolean;
  reportLang: unknown;
};

/** Shape-validate a CohortRunRequest body. Null = malformed (a duplicate member id or a
 *  membership outside MEMBERSHIPS included). The size rule is the caller's (it needs the
 *  bounds as data for the refusal). */
export function parseCohortRunRequest(body: unknown): ParsedRunRequest | null {
  const b = body as { jdSlug?: unknown; members?: unknown; blind?: unknown; reportLang?: unknown } | null;
  if (!b || typeof b.jdSlug !== "string" || !b.jdSlug.trim() || !Array.isArray(b.members)) return null;
  if (b.blind !== undefined && typeof b.blind !== "boolean") return null;
  const members: ParsedRunRequest["members"] = [];
  const ids = new Set<string>();
  for (const m of b.members as Array<{ memberId?: unknown; membership?: unknown }>) {
    if (!m || typeof m.memberId !== "string" || !m.memberId.trim() || m.memberId.length > 200) return null;
    if (typeof m.membership !== "string" || !(MEMBERSHIPS as readonly string[]).includes(m.membership)) return null;
    if (ids.has(m.memberId)) return null;
    ids.add(m.memberId);
    members.push({ memberId: m.memberId, membership: m.membership as Membership });
  }
  return { jdSlug: b.jdSlug.trim(), members, blind: b.blind === true, reportLang: b.reportLang };
}

// ---- the real stores ------------------------------------------------------------------

/** The production readers (the proposal, POST and the runner share them). */
export function cohortSourceReaders(): SourceReaders {
  return {
    cvFacts: listAnalysisCohortCvFacts,
    profileFacts: listAnalysisCohortProfileFacts,
    withholdsPii: (label, workspaceId) => candidateLabelWithholdsPii(label, workspaceId),
  };
}

/** The JD-level reads; the job is visibility-gated like every by-id job route. */
export function cohortJdDeps(): Pick<ProposalDeps, "loadJd" | "getJob" | "org"> {
  return {
    loadJd: (slug, workspaceId) => loadJd(slug, workspaceId),
    getJob: (jobId, workspaceId) => (jobVisibleToWorkspace(jobId, workspaceId) ? getJob(jobId, workspaceId) : null),
    org: (workspaceId) => {
      const orgId = getWorkspaceOrgId(workspaceId);
      const org = orgId ? getOrganization(orgId) : null;
      return org ? { name: org.name, domain: org.domain } : null;
    },
  };
}

// The pool + ranker wiring (`cohortProposalDeps`) lives in the proposal ROUTE: only that
// door ranks, and keeping candidate-pool + recruiter-run off this module keeps them off
// the POST route and the runner (perf-budget.json).
