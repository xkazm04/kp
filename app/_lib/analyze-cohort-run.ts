// Cohort Studio runner (tasks.ts `analyze_cohort`, registered in late-bound-boot.ts).
//
// One task = one analysis_cohorts row. Per member (three at a time, abort honoured
// between schedules):
//   - reuse:  an analysis of this CV is already filed against the JD -> "reused", no debit;
//   - fresh:  the source's CV text goes through the EXISTING single-variant analyze path
//             (runAnalyze: same CLI args, cache, persistAnalysis with jd_slug = the JD,
//             and its one-unit debit per delivered, non-cached analysis) -> "done";
//   - GitHub: !blind, a technical role family and a github.com link on the CV -> the
//             existing analyze_github stage (registry lookup) under the github-analysis
//             budget of the IP that started the run;
//   - a failing member is "failed" with a CODE and the cohort continues.
// Then the comparative pass: cohort_compare_cli under TWO presentation orders (neutral,
// reversed); a cell comment survives only when both orders commented the same
// (memberId, dimension), a dimension note only when both wrote one; the narrative is run
// one's. The claims are the code's (cohortClaims.ts) and ride in as fixed inputs.
//
// `runCohortCore` is pure over injected deps (analyze-cohort-run.test.ts drives it without
// a spawn); `runAnalyzeCohortTask` is the wiring.

import path from "node:path";
import { writeFile } from "node:fs/promises";
import {
  COHORT_DIMENSIONS,
  NARRATIVE_TOP,
  isCohortDimension,
  isTechnicalFamily,
  type CohortComments,
  type CohortDimension,
  type CohortNarrative,
  type CohortView,
  type MemberRunState,
} from "../features/tools/analyze/cohort/cohortTypes";
import type { Analysis } from "./schemas";
import type { AnalysisCohortMemberRecord, AnalysisCohortRecord } from "./db/analysis-cohorts";
import type { ResolvedCohortSource } from "./analyze-cohort-proposal";
import type { ExternalTaskCtx } from "./task-external-runners";

/** Members analysed at once. Each fresh one is a Python child under the process-wide
 *  engine semaphore (KP_PYTHON_MAX_CONCURRENT, default 4), so three leaves a slot free. */
export const COHORT_MEMBER_CONCURRENCY = 3;

/** The comparative pass's wall clock per order (the CLI's own provider timeout is 120s). */
export const COHORT_COMPARE_TIMEOUT_MS = 180_000;

/** The JD/company text past which it rides as a workdir file, not one argv element
 *  (the same limit /api/analyze spills at: ~32KB total argv on Windows). */
const ARGV_TEXT_LIMIT = 8 * 1024;

/** A coded member failure. `code` is an errors.<CODE> key, never engine text. */
export class CohortMemberError extends Error {
  code: string;
  constructor(code: string, detail?: string) {
    super(detail ?? code);
    this.code = code;
  }
}

// ---- the comparative pass: input + the two-order intersection -------------------------

export type CompareMemberInput = {
  memberId: string;
  label: string;
  fitRank: number | null;
  cells: Partial<Record<CohortDimension, { rating: number | null; tier: string; label: string; absentReason?: string }>>;
  facts: Record<string, unknown>;
};

export type CompareInput = {
  lang: string;
  blind: boolean;
  jdTitle: string;
  members: CompareMemberInput[];
  claims: CohortView["claims"];
  narrativeTop: string[];
  leavesOut: number;
};

/** What one cohort_compare_cli run answers (already shape-checked by the CLI). */
export type CompareOutput = {
  cells: Array<{ memberId: string; dimension: string; comment: string }>;
  notes: Record<string, string>;
  narrative: { covers: string[]; leavesOut: number; text: string } | null;
  engine: "model" | "keyless";
  /** Items the CLI refused, each with its rule (cohort_compare.DROP_REASONS). */
  dropped: Array<{ item: string; reason: string }>;
  /** Items the CLI cut back to their last whole sentence (kept, but shortened). */
  trimmed: string[];
};

const short = (v: unknown, n: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
const firstN = (v: unknown, n: number): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, n) : []);

/** The compact facts per member: ratings, tiers, label keys, a few detail strings. Never
 *  the CV text and never a name in a blind cohort (labels come from the blind-safe view,
 *  and the detail strings the engine projected are already redacted there). */
export function compareFactsOf(m: CohortView["members"][number]): Record<string, unknown> {
  const d = m.detail;
  return {
    fit: d.fit ? { seniorityAlignment: d.fit.seniorityAlignment, roleAlignment: d.fit.roleAlignment, summary: short(d.fit.summary, 280), riskFlags: firstN(d.fit.riskFlags, 3) } : null,
    skills: d.skills ? { matched: firstN(d.skills.matched, 8), missing: firstN(d.skills.missing, 6), unproven: firstN(d.skills.unproven, 4) } : null,
    experience: d.experience ? { years: d.experience.years, seniority: d.experience.seniority, roleFamily: d.experience.roleFamily } : null,
    signals: d.signals
      ? { strengths: d.signals.strengths.slice(0, 3).map((s) => s.label), antipatterns: d.signals.antipatterns.slice(0, 3).map((s) => s.label) }
      : null,
    trust: d.trust ? { findings: d.trust.findings.filter((f) => f.severity !== "ok").slice(0, 4).map((f) => `${f.severity}:${f.code}`) } : null,
    salary: d.salary ? { midpoint: d.salary.midpoint, currency: d.salary.currency, period: d.salary.period } : null,
    publicWork: d.publicWork ? { publicRepos: d.publicWork.publicRepos, activeRepos: d.publicWork.activeRepos, matchedSkills: firstN(d.publicWork.matchedSkills, 6) } : null,
  };
}

/** The pass's input for one presentation order. Only members with a landed analysis are
 *  compared; `narrativeTop` is the strongest NARRATIVE_TOP by fit rank (code-decided). */
export function buildCompareInput(view: CohortView, order: "neutral" | "reversed"): CompareInput {
  const landed = view.members.filter((m) => m.runState === "done" || m.runState === "reused");
  const byNeutral = [...landed].sort((a, b) => a.neutralIndex - b.neutralIndex);
  const ordered = order === "reversed" ? byNeutral.reverse() : byNeutral;
  const ranked = landed.filter((m) => m.fitRank != null).sort((a, b) => (a.fitRank ?? 0) - (b.fitRank ?? 0));
  const narrativeTop = ranked.slice(0, NARRATIVE_TOP).map((m) => m.memberId);
  return {
    lang: view.reportLang,
    blind: view.blind,
    jdTitle: view.jdTitle,
    members: ordered.map((m) => ({
      memberId: m.memberId,
      label: m.label,
      fitRank: m.fitRank,
      cells: Object.fromEntries(
        COHORT_DIMENSIONS.map((dim) => {
          const c = m.cells[dim];
          return [dim, { rating: c.rating, tier: c.tier, label: c.label.key, ...(c.absentReason ? { absentReason: c.absentReason } : {}) }];
        })
      ),
      facts: compareFactsOf(m),
    })),
    claims: view.claims,
    narrativeTop,
    leavesOut: Math.max(0, landed.length - narrativeTop.length),
  };
}

/** One model item that did not reach the stored comparison, and the rule that refused
 *  it. `run` is the presentation order (1 neutral, 2 reversed); `reason` is a
 *  cohort_compare.DROP_REASONS code, or "order-disagreement" for an item only one of the
 *  two orders produced. */
export type CohortCommentDrop = { run: 1 | 2; item: string; reason: string };

/** The drop tally stored beside the comments (comments_json), so a paid-for answer that
 *  never reached the screen is counted and named — never a silent discard. Not on the
 *  wire contract (cohortTypes.ts) today: the engine reads only cells/notes/narrative. */
export type CohortCommentDrops = { total: number; byReason: Record<string, number>; trimmed: number; items: CohortCommentDrop[] };

export type StoredCohortComments = CohortComments & { dropped: CohortCommentDrops };

/** The shown comment cap — cohort_compare.comment_cap: ~1 per 4 members, at least one.
 *  Each order may SUGGEST twice this (suggestion_cap); the cap binds after the intersection. */
export function cohortCommentCap(memberCount: number): number {
  return memberCount > 0 ? Math.max(1, Math.floor(memberCount / 4)) : 0;
}

/** How many drop items are kept verbatim on the row (the counts are always complete). */
const DROP_ITEMS_KEPT = 60;

/** Keep only what BOTH presentation orders produced: a cell comment for the same
 *  (memberId, dimension) — run one's text, then the shown cap (cohortCommentCap) in run
 *  one's order; a note for the same dimension — run one's;
 *  the narrative is run one's, its `covers` restricted to the code-decided top. Every
 *  item that does not survive — refused inside a run, or produced by one order only —
 *  is counted in `dropped`. */
export function intersectCompareRuns(a: CompareOutput, b: CompareOutput, input: CompareInput): StoredCohortComments {
  const drops: CohortCommentDrop[] = [
    ...a.dropped.map((d) => ({ run: 1 as const, ...d })),
    ...b.dropped.map((d) => ({ run: 2 as const, ...d })),
  ];
  const memberIds = new Set(input.members.map((m) => m.memberId));
  const keyOf = (c: { memberId: string; dimension: string }) => `${c.memberId}\u0000${c.dimension}`;
  const inA = new Set(a.cells.map(keyOf));
  const inB = new Set(b.cells.map(keyOf));
  const seen = new Set<string>();
  const cells: CohortComments["cells"] = [];
  for (const c of a.cells) {
    const key = keyOf(c);
    const item = `cell:${c.memberId}/${c.dimension}`;
    if (!memberIds.has(c.memberId)) drops.push({ run: 1, item, reason: "unknown-member" });
    else if (!isCohortDimension(c.dimension)) drops.push({ run: 1, item, reason: "unknown-dimension" });
    else if (seen.has(key)) drops.push({ run: 1, item, reason: "duplicate" });
    else if (!inB.has(key)) drops.push({ run: 1, item, reason: "order-disagreement" });
    else if (cells.length >= cohortCommentCap(input.members.length)) drops.push({ run: 1, item, reason: "over-cap" });
    else {
      const comment = c.comment.trim().slice(0, 90);
      if (!comment) {
        drops.push({ run: 1, item, reason: "empty" });
        continue;
      }
      seen.add(key);
      cells.push({ memberId: c.memberId, dimension: c.dimension, comment });
    }
  }
  for (const c of b.cells) if (!inA.has(keyOf(c))) drops.push({ run: 2, item: `cell:${c.memberId}/${c.dimension}`, reason: "order-disagreement" });
  const notes: CohortComments["notes"] = {};
  for (const dim of COHORT_DIMENSIONS) {
    const na = a.notes[dim]?.trim();
    const nb = b.notes[dim]?.trim();
    if (na && nb) notes[dim] = na.slice(0, 160);
    else if (na) drops.push({ run: 1, item: `note:${dim}`, reason: "order-disagreement" });
    else if (nb) drops.push({ run: 2, item: `note:${dim}`, reason: "order-disagreement" });
  }
  let narrative: CohortNarrative | null = null;
  if (a.narrative?.text.trim()) {
    const top = new Set(input.narrativeTop);
    const covers = a.narrative.covers.filter((id) => top.has(id));
    narrative = {
      covers: covers.length ? covers : [...input.narrativeTop],
      leavesOut: input.leavesOut,
      text: a.narrative.text.trim().slice(0, 900),
      // Run one's narrative is the one kept, so run one says who wrote it.
      engine: a.engine,
    };
  }
  const byReason: Record<string, number> = {};
  for (const d of drops) byReason[d.reason] = (byReason[d.reason] ?? 0) + 1;
  return {
    cells,
    notes,
    narrative,
    dropped: { total: drops.length, byReason, trimmed: a.trimmed.length + b.trimmed.length, items: drops.slice(0, DROP_ITEMS_KEPT) },
  };
}

// ---- the pure core -----------------------------------------------------------------

export type CohortRunDeps = {
  signal: AbortSignal;
  progress: (done: number, total: number) => void;
  load: () => AnalysisCohortRecord | null;
  updateMember: (memberId: string, patch: Partial<Pick<AnalysisCohortMemberRecord, "runState" | "analysisSlug" | "error">>) => void;
  setStatus: (status: AnalysisCohortRecord["status"]) => void;
  setComments: (comments: CohortComments | null) => void;
  /** Re-resolved at run time: a member erased or consent-expired since the POST is refused. */
  resolveSource: (memberId: string) => ResolvedCohortSource | null;
  findReuse: (source: ResolvedCohortSource) => string | null;
  /** The existing single-variant analyze path; resolves to the saved slug, throws coded. */
  analyzeFresh: (source: ResolvedCohortSource) => Promise<string>;
  loadAnalysis: (slug: string) => { analysis: Analysis | null; hasGithub: boolean } | null;
  /** Spend one unit of the github-analysis budget; false = the budget refused it. */
  githubAllowed: () => boolean;
  runGithub: (slug: string, profileUrl: string) => Promise<void>;
  parseGithubUsername: (link: string) => string | null;
  buildView: () => CohortView;
  /** Persist the names handed to the model (memberId -> label) for the erasure scrub. */
  recordShownNames: (names: Record<string, string>) => void;
  compare: (input: CompareInput) => Promise<CompareOutput>;
};

export type CohortRunSummary = {
  cohortId: string;
  status: AnalysisCohortRecord["status"];
  members: number;
  reused: number;
  done: number;
  failed: number;
  /** Who wrote the comments: the task drawer's provenance line. */
  source: "llm" | "deterministic" | null;
};

const FINISHED: readonly MemberRunState[] = ["reused", "done", "failed"];

/** The first CV link a GitHub handle parses from (github.com only). */
export function githubLinkFor(analysis: Analysis, parse: (link: string) => string | null): string | null {
  for (const link of analysis.candidate?.links ?? []) {
    if (typeof link === "string" && /github\.com/i.test(link) && parse(link)) return link;
  }
  return null;
}

export async function runCohortCore(deps: CohortRunDeps): Promise<CohortRunSummary> {
  const rec = deps.load();
  if (!rec) throw new CohortMemberError("COHORT_NOT_FOUND");
  deps.setStatus("running");
  const total = rec.members.length;
  let finished = rec.members.filter((m) => FINISHED.includes(m.runState)).length;
  deps.progress(finished, total);
  const pending = rec.members.filter((m) => !FINISHED.includes(m.runState));
  const states = new Map<string, MemberRunState>(rec.members.map((m) => [m.memberId, m.runState]));

  const github = async (slug: string) => {
    if (rec.blind) return;
    const loaded = deps.loadAnalysis(slug);
    const analysis = loaded?.analysis;
    if (!analysis || loaded.hasGithub || !isTechnicalFamily(analysis.candidate?.roleFamily)) return;
    const link = githubLinkFor(analysis, deps.parseGithubUsername);
    if (!link || !deps.githubAllowed()) return;
    try {
      await deps.runGithub(slug, link);
    } catch (error) {
      console.error(`[analyze-cohort] the GitHub stage for "${slug}" did not run`, error);
    }
  };

  const runMember = async (m: AnalysisCohortMemberRecord) => {
    const set = (patch: Parameters<CohortRunDeps["updateMember"]>[1]) => {
      deps.updateMember(m.memberId, patch);
      if (patch.runState) states.set(m.memberId, patch.runState);
    };
    try {
      const source = deps.resolveSource(m.memberId);
      if (!source) throw new CohortMemberError("COHORT_MEMBER_NOT_FOUND");
      const reused = deps.findReuse(source);
      let slug: string;
      if (reused) {
        slug = reused;
        set({ runState: "reused", analysisSlug: slug, error: null });
      } else {
        set({ runState: "analyzing", error: null });
        slug = await deps.analyzeFresh(source);
        set({ runState: "done", analysisSlug: slug, error: null });
      }
      if (!deps.signal.aborted) await github(slug);
    } catch (error) {
      const code = error instanceof CohortMemberError ? error.code : "ENGINE_FAILED";
      if (!(error instanceof CohortMemberError)) console.error(`[analyze-cohort] member "${m.memberId}" failed`, error);
      // An aborted member is not a failed one: it goes back to the queue it came from.
      set(deps.signal.aborted ? { runState: "queued", error: null } : { runState: "failed", error: code });
    } finally {
      finished += 1;
      deps.progress(Math.min(finished, total), total);
    }
  };

  // A small worker pool: each worker takes the next member only while the run is live,
  // so an abort stops SCHEDULING at once (an in-flight child is SIGKILLed by its own
  // signal through runAnalyze/spawnPython).
  let next = 0;
  const worker = async () => {
    while (next < pending.length && !deps.signal.aborted) {
      const m = pending[next];
      next += 1;
      await runMember(m);
    }
  };
  await Promise.all(Array.from({ length: Math.min(COHORT_MEMBER_CONCURRENCY, pending.length) }, worker));

  const count = (s: MemberRunState) => [...states.values()].filter((v) => v === s).length;
  const summary = (status: AnalysisCohortRecord["status"], source: CohortRunSummary["source"]): CohortRunSummary => ({
    cohortId: rec.id,
    status,
    members: total,
    reused: count("reused"),
    done: count("done"),
    failed: count("failed"),
    source,
  });

  if (deps.signal.aborted) {
    deps.setStatus("failed");
    // An empty message: the task row's 'canceled' is the real signal (the runner marks it).
    throw new CohortMemberError("COHORT_CANCELED", "");
  }
  if (count("reused") + count("done") === 0) {
    deps.setStatus("failed");
    return summary("failed", null);
  }

  // The comparative pass. Its failure never fails the comparison: the claims stand on
  // their own and the view simply carries no comments and no narrative.
  let comments: CohortComments | null = null;
  try {
    const view = deps.buildView();
    const neutral = buildCompareInput(view, "neutral");
    if (!rec.blind) deps.recordShownNames(Object.fromEntries(neutral.members.map((m) => [m.memberId, m.label])));
    if (neutral.members.length >= 2) {
      const reversed = buildCompareInput(view, "reversed");
      const [a, b] = await Promise.all([deps.compare(neutral), deps.compare(reversed)]);
      const stored = intersectCompareRuns(a, b, neutral);
      if (stored.dropped.total > 0) {
        console.warn(`[analyze-cohort] "${rec.id}": ${stored.dropped.total} model item(s) dropped ${JSON.stringify(stored.dropped.byReason)}`);
      }
      comments = stored;
    }
  } catch (error) {
    console.error(`[analyze-cohort] the comparative pass for "${rec.id}" did not run`, error);
  }
  deps.setComments(comments);
  deps.setStatus("done");
  return summary("done", comments?.narrative ? (comments.narrative.engine === "model" ? "llm" : "deterministic") : null);
}

// ---- the wiring --------------------------------------------------------------------

/** The github-analysis bucket (the SAME one /api/github-analysis and /api/analyze charge). */
export const COHORT_GITHUB_BUDGET = { limit: 10, windowMs: 10 * 60_000 };

/** Shape-check one CLI answer; anything malformed reads as "said nothing". */
export function parseCompareOutput(raw: unknown): CompareOutput {
  const r = (raw ?? {}) as { cells?: unknown; notes?: unknown; narrative?: unknown; engine?: unknown; dropped?: unknown; trimmed?: unknown };
  const cells = Array.isArray(r.cells)
    ? (r.cells as Array<Record<string, unknown>>).flatMap((c) =>
        c && typeof c.memberId === "string" && typeof c.dimension === "string" && typeof c.comment === "string"
          ? [{ memberId: c.memberId, dimension: c.dimension, comment: c.comment }]
          : []
      )
    : [];
  const notes: Record<string, string> = {};
  if (r.notes && typeof r.notes === "object") {
    for (const [k, v] of Object.entries(r.notes as Record<string, unknown>)) if (typeof v === "string") notes[k] = v;
  }
  const n = r.narrative as { covers?: unknown; leavesOut?: unknown; text?: unknown } | null | undefined;
  const narrative =
    n && typeof n.text === "string"
      ? {
          covers: Array.isArray(n.covers) ? n.covers.filter((x): x is string => typeof x === "string") : [],
          leavesOut: typeof n.leavesOut === "number" ? n.leavesOut : 0,
          text: n.text,
        }
      : null;
  const dropped = Array.isArray(r.dropped)
    ? (r.dropped as Array<Record<string, unknown>>).flatMap((d) =>
        d && typeof d.item === "string" && typeof d.reason === "string" ? [{ item: d.item, reason: d.reason }] : []
      )
    : [];
  const trimmed = Array.isArray(r.trimmed) ? r.trimmed.filter((x): x is string => typeof x === "string") : [];
  return { cells, notes, narrative, engine: r.engine === "model" ? "model" : "keyless", dropped, trimmed };
}

export async function runAnalyzeCohortTask(ctx: ExternalTaskCtx): Promise<CohortRunSummary | { status: "skipped"; reason: string }> {
  const [store, proposal, view, analysesDb, jobsDb, runner, analyzeRun, llm, rate, logger, handle, externals] = await Promise.all([
    import("./db/analysis-cohorts"),
    import("./analyze-cohort-proposal"),
    import("./analyze-cohort-view"),
    import("./db/analyses"),
    import("./db/jobs"),
    import("./python-runner"),
    import("./analyze-run"),
    import("./llm-config"),
    import("./rate-limit"),
    import("./logger"),
    import("./github-handle"),
    import("./task-external-runners"),
  ]);
  const ws = ctx.workspaceId;
  const cohortId = typeof ctx.params.cohortId === "string" ? ctx.params.cohortId : "";
  const githubBudgetKey = typeof ctx.params.githubBudgetKey === "string" ? ctx.params.githubBudgetKey : null;
  const rec0 = cohortId ? store.getAnalysisCohort(cohortId, ws) : null;
  if (!rec0) return { status: "skipped", reason: "no_cohort" };

  const readers = proposal.cohortSourceReaders();
  const jdCtx = proposal.cohortJdContext(rec0.jdSlug, ws, proposal.cohortJdDeps());
  if (!jdCtx) {
    store.setAnalysisCohortStatus(cohortId, "failed", ws);
    return { status: "skipped", reason: "no_jd" };
  }
  const jdBody = jobsDb.loadJd(rec0.jdSlug, ws)?.body ?? "";
  const reuseRows = store.listAnalysisCohortReuseRows(rec0.jdSlug, ws);
  const viewDeps = view.cohortViewDeps();

  const spill = async (dir: string, name: string, text: string | null): Promise<{ text: string | null; path: string | null }> => {
    if (!text?.trim()) return { text: null, path: null };
    if (Buffer.byteLength(text, "utf8") <= ARGV_TEXT_LIMIT) return { text, path: null };
    const p = path.join(dir, `${name}.txt`);
    await writeFile(p, text, "utf-8");
    return { text: null, path: p };
  };

  return runCohortCore({
    signal: ctx.signal,
    progress: (done, total) => ctx.progress(done, total),
    load: () => store.getAnalysisCohort(cohortId, ws),
    updateMember: (memberId, patch) => {
      store.updateAnalysisCohortMember(cohortId, memberId, patch, ws);
    },
    setStatus: (status) => {
      store.setAnalysisCohortStatus(cohortId, status, ws);
    },
    setComments: (comments) => {
      store.setAnalysisCohortComments(cohortId, comments, ws);
    },
    resolveSource: (memberId) => proposal.resolveCohortSources([memberId], ws, readers).get(memberId) ?? null,
    findReuse: (source) => proposal.findReusableAnalysis(source, reuseRows),
    analyzeFresh: async (source) => {
      const cv = analysesDb.loadAnalysis(source.cvSlug, ws);
      const rawText = (cv?.payload as { candidate?: { rawText?: unknown } } | null)?.candidate?.rawText;
      if (typeof rawText !== "string" || !rawText.trim()) throw new CohortMemberError("COHORT_MEMBER_NOT_FOUND");
      const baseDir = await runner.createWorkdir();
      try {
        const cvPath = path.join(baseDir, "cv.txt");
        await writeFile(cvPath, rawText, "utf-8");
        const jd = await spill(baseDir, "job-description", jdBody);
        const co = await spill(baseDir, "company", jdCtx.companyText);
        const result = (await analyzeRun.runAnalyze(
          {
            baseDir,
            grounding: false,
            variants: [{ label: source.label, cvPath, ...(source.cvHash ? { cvHash: source.cvHash } : {}) }],
            jobDescriptionText: jd.text,
            jobDescriptionPath: jd.path,
            companyText: co.text,
            companyPath: co.path,
            jdSlug: rec0.jdSlug,
            requestId: logger.newRequestId(),
            lang: rec0.reportLang as Parameters<typeof analyzeRun.runAnalyze>[0]["lang"],
            blind: rec0.blind,
            workspace: ws,
          },
          undefined,
          ctx.signal
        )) as { persistence?: { slug?: unknown } | null };
        const slug = result?.persistence?.slug;
        if (typeof slug !== "string") throw new CohortMemberError("ANALYSIS_SAVE_FAILED");
        return slug;
      } catch (error) {
        if (error instanceof CohortMemberError) throw error;
        const refusal = (error as { code?: unknown } | null)?.code;
        throw new CohortMemberError(refusal === analyzeRun.ANALYZE_TIMEOUT_CODE ? "ANALYZE_TIMEOUT" : "ENGINE_FAILED", error instanceof Error ? error.message : String(error));
      } finally {
        // runAnalyze cleans its own workdir; this covers a throw before it was reached.
        await runner.cleanupWorkdir(baseDir);
      }
    },
    loadAnalysis: (slug) => {
      const found = analysesDb.loadAnalysis(slug, ws);
      if (!found) return null;
      const parsed = (view.loadCohortMemberAnalysis(slug, ws, viewDeps).analysis ?? null) as Analysis | null;
      return { analysis: parsed, hasGithub: Boolean(found.row.github_json) };
    },
    githubAllowed: () => (githubBudgetKey ? rate.rateLimit(githubBudgetKey, COHORT_GITHUB_BUDGET) : false),
    runGithub: async (slug, profileUrl) => {
      await externals.externalRunner(analyzeRun.ANALYZE_GITHUB_RUNNER)({
        workspaceId: ws,
        signal: ctx.signal,
        progress: () => {},
        params: { profile: profileUrl, blind: false, jdText: jdBody.slice(0, 20_000), savedSlug: slug, requestId: logger.newRequestId() },
      });
    },
    parseGithubUsername: handle.parseGithubUsername,
    recordShownNames: (names) => {
      store.recordAnalysisCohortShownNames(cohortId, names, ws);
    },
    buildView: () => {
      const rec = store.getAnalysisCohort(cohortId, ws);
      if (!rec) throw new CohortMemberError("COHORT_NOT_FOUND");
      return view.assembleAnalysisCohortView(rec, jdCtx, viewDeps, null);
    },
    compare: async (input) => {
      const { buildLlmConfigEnv } = llm;
      const workdir = await runner.createWorkdir();
      try {
        const inputPath = path.join(workdir, "cohort.json");
        await writeFile(inputPath, JSON.stringify(input), "utf-8");
        const { result } = runner.spawnPython(["-m", "pipeline.jobfit.cohort_compare_cli", "--input-json", inputPath, "--lang", input.lang], {
          signal: ctx.signal,
          timeoutMs: COHORT_COMPARE_TIMEOUT_MS,
          env: buildLlmConfigEnv(),
        });
        const { stdout, stderr, exitCode } = await result;
        if (exitCode !== 0) throw new runner.PipelineError(runner.parseStderrError(stderr, exitCode));
        return parseCompareOutput(runner.parsePythonJson<unknown>(stdout, stderr));
      } finally {
        await runner.cleanupWorkdir(workdir);
      }
    },
  });
}
