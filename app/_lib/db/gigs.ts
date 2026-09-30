import { createHash } from "node:crypto";
import { canTransitionGig } from "../gigs/transitions";
import {
  isGigArena,
  isGigSourceStateName,
  isGigStatus,
  isGigSuspectReason,
  type Gig,
  type GigArena,
  type GigBrief,
  type GigQualification,
  type GigReward,
  type GigSourceState,
  type GigStatus,
  type GigSuspectReason,
  type GigWithdrawReason,
  type GigReport,
  GIG_REPORT_STAGES,
  type RawGig,
} from "../gigs/types";
import { randomId } from "../random-id";
import { ensureDb, safeRowParse } from "./core";

// The gig dataset (app/_lib/gigs/types.ts): one row per real-world listing per source,
// keyed by (workspace, COALESCE(source_id, 'manual'), external_key) so a re-scan UPDATES
// a row instead of duplicating it and a brief forwarded twice lands once.
//
// Tenancy: every statement binds `workspace_id = ?`, point reads included
// (gigs-tenancy.test.ts). No carve-out, and no tenant default: workspaceId is the first,
// required parameter of every export.
//
// Status moves go through transitionGig - a compare-and-swap under `.immediate()` with
// the `from` set re-asserted in the UPDATE's WHERE, refused with `illegal` before any
// read when GIG_TRANSITIONS (gigs/transitions.ts) does not hold the edge. The one other
// writer of `status` is upsertGigFromRaw, and it too only takes edges the map holds.

type GigRow = {
  id: string;
  workspace_id: string;
  source_id: string | null;
  arena: string;
  external_key: string;
  url: string;
  title: string;
  org: string | null;
  reward_json: string | null;
  deadline_at: string | null;
  posted_at: string | null;
  body_text: string;
  tags_json: string;
  niche: string | null;
  status: string;
  suspect_reasons_json: string;
  specialist_id: string | null;
  qualification_json: string | null;
  /** Added by ALTER (core.ts): NULL on every row until the gig is researched. */
  brief_json?: string | null;
  brief_at?: string | null;
  /** Added by ALTER (core.ts): NULL until the gig's workspace is prepared (gigs/project.ts). */
  workdir?: string | null;
  personas_project_id?: string | null;
  /** Added by ALTER (core.ts): the brief challenge the gig was withdrawn for, or NULL. */
  withdraw_reason_json?: string | null;
  /** Added by ALTER (core.ts): the gig's HTML report record, or NULL. */
  report_json?: string | null;
  /** Added by ALTER (core.ts): NULL until a freshness check read the listing's source state. */
  source_state_json?: string | null;
  freshness_checked_at?: string | null;
  created_at: string;
  updated_at: string;
};

function parseStringArray(json: string | null, ctx: string, id: string): string[] {
  const parsed = safeRowParse<unknown>(json, ctx, id);
  return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
}

function gigFromRow(row: GigRow): Gig {
  const reward = safeRowParse<GigReward>(row.reward_json, "gig.reward", row.id);
  const qualification = safeRowParse<GigQualification>(row.qualification_json, "gig.qualification", row.id);
  return {
    id: row.id,
    sourceId: row.source_id,
    // arena/status are written from typed values only; the fallbacks keep a row whose
    // vocabulary was retired renderable (and deletable) instead of throwing.
    arena: isGigArena(row.arena) ? row.arena : "freelance",
    externalKey: row.external_key,
    url: row.url,
    title: row.title,
    org: row.org,
    reward: reward && typeof reward === "object" ? reward : null,
    deadlineAt: row.deadline_at,
    postedAt: row.posted_at,
    bodyText: row.body_text,
    tags: parseStringArray(row.tags_json, "gig.tags", row.id),
    niche: row.niche,
    status: isGigStatus(row.status) ? row.status : "new",
    suspectReasons: parseStringArray(row.suspect_reasons_json, "gig.suspectReasons", row.id).filter(isGigSuspectReason),
    specialistId: row.specialist_id,
    qualification: qualification && typeof qualification === "object" ? qualification : null,
    brief: briefFromJson(row.brief_json ?? null, row.id),
    workdir: row.workdir ?? null,
    personasProjectId: row.personas_project_id ?? null,
    withdrawReason: withdrawReasonFromJson(row.withdraw_reason_json ?? null, row.id),
    report: reportFromJson(row.report_json ?? null, row.id),
    sourceState: sourceStateFromJson(row.source_state_json ?? null, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** A stored brief is read back only in the shape this build writes (`version: 1`, the
 *  Markdown a string, the lists arrays); anything else reads as "not researched", so the
 *  on-demand research door can write a fresh one instead of the UI painting a half-object. */
function briefFromJson(json: string | null, id: string): GigBrief | null {
  const parsed = safeRowParse<Partial<GigBrief>>(json, "gig.brief", id);
  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.version !== 1 || typeof parsed.markdown !== "string") return null;
  if (!Array.isArray(parsed.sections) || !Array.isArray(parsed.links) || !Array.isArray(parsed.challenges)) return null;
  return parsed as GigBrief;
}

/** A stored withdraw reason in the shape this build writes, else null (unknown). */
function withdrawReasonFromJson(json: string | null, id: string): GigWithdrawReason | null {
  const parsed = safeRowParse<Partial<GigWithdrawReason>>(json, "gig.withdrawReason", id);
  if (!parsed || typeof parsed !== "object") return null;
  if (typeof parsed.challenge !== "string" || !parsed.challenge.trim() || typeof parsed.index !== "number" || typeof parsed.at !== "string") return null;
  return { challenge: parsed.challenge, index: parsed.index, at: parsed.at };
}

/** A stored source state in the shape this build writes, else null (not checked). */
function sourceStateFromJson(json: string | null, id: string): GigSourceState | null {
  const parsed = safeRowParse<Partial<GigSourceState>>(json, "gig.sourceState", id);
  if (!parsed || typeof parsed !== "object" || !isGigSourceStateName(parsed.state) || typeof parsed.checkedAt !== "string") return null;
  return {
    state: parsed.state,
    detail: typeof parsed.detail === "string" ? parsed.detail : null,
    bidCount: typeof parsed.bidCount === "number" && Number.isFinite(parsed.bidCount) ? parsed.bidCount : null,
    checkedAt: parsed.checkedAt,
  };
}

/** A stored report record in the shape this build writes, else null (none yet). */
function reportFromJson(json: string | null, id: string): GigReport | null {
  const p = safeRowParse<Partial<GigReport>>(json, "gig.report", id);
  if (!p || typeof p !== "object" || typeof p.path !== "string" || typeof p.generatedAt !== "string") return null;
  return {
    path: p.path,
    stage: (GIG_REPORT_STAGES as readonly unknown[]).includes(p.stage) ? (p.stage as GigReport["stage"]) : "researched",
    status: p.status === "writing" || p.status === "failed" ? p.status : "ready",
    source: p.source === "llm" ? "llm" : "deterministic",
    model: typeof p.model === "string" && p.model ? p.model : null,
    fallbackReason: typeof p.fallbackReason === "string" ? p.fallbackReason : null,
    costUsd: typeof p.costUsd === "number" ? p.costUsd : null,
    generatedAt: p.generatedAt,
  };
}

function cleanTitle(title: string): string {
  return title.trim().slice(0, 300) || "Untitled gig";
}

function cleanTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (const t of tags) {
    const v = typeof t === "string" ? t.trim().slice(0, 80) : "";
    if (v && !out.includes(v)) out.push(v);
    if (out.length >= 40) break;
  }
  return out;
}

function uniqueReasons(reasons: readonly GigSuspectReason[]): GigSuspectReason[] {
  return [...new Set(reasons.filter(isGigSuspectReason))];
}

export function getGig(workspaceId: string, id: string): Gig | null {
  const row = ensureDb()
    .prepare(`SELECT * FROM gigs WHERE id = ? AND workspace_id = ?`)
    .get(id, workspaceId) as GigRow | undefined;
  return row ? gigFromRow(row) : null;
}

export type ListGigsOptions = {
  arena?: GigArena;
  statuses?: readonly GigStatus[];
  /** Page size, 1..200 (default 50). */
  limit?: number;
  /** Keyset cursor: only rows whose updated_at is strictly before this ISO timestamp
   *  (pass the last row's `updatedAt`). */
  before?: string;
};

/** Newest-touched first (updated_at DESC, id DESC). The tenant predicate is LITERAL in
 *  the SQL, never assembled into `clauses` - a scoping the source guard cannot see is
 *  not a scoping. */
export function listGigs(workspaceId: string, opts: ListGigsOptions = {}): Gig[] {
  const limit = Math.max(1, Math.min(200, Math.trunc(opts.limit ?? 50) || 50));
  const clauses: string[] = [];
  const args: (string | number)[] = [workspaceId];
  if (opts.arena) {
    clauses.push("arena = ?");
    args.push(opts.arena);
  }
  if (opts.statuses) {
    const statuses = opts.statuses.filter(isGigStatus);
    // An explicit empty filter matches nothing, never everything.
    if (statuses.length === 0) return [];
    clauses.push(`status IN (${statuses.map(() => "?").join(", ")})`);
    args.push(...statuses);
  }
  if (typeof opts.before === "string" && opts.before) {
    clauses.push("updated_at < ?");
    args.push(opts.before);
  }
  args.push(limit);
  const extra = clauses.map((c) => " AND " + c).join("");
  const rows = ensureDb()
    .prepare(
      `SELECT * FROM gigs
       WHERE workspace_id = ?${extra}
       ORDER BY updated_at DESC, rowid DESC
       LIMIT ?`
    )
    .all(...args) as GigRow[];
  return rows.map(gigFromRow);
}

export type UpsertGigFromRawInput = {
  sourceId: string;
  arena: GigArena;
  raw: RawGig;
  /** The deterministic honeypot scan's findings for this listing ([] = clean). */
  suspectReasons: readonly GigSuspectReason[];
};

/** Reconcile one listing a source returned. A new listing is inserted as `new`, or as
 *  `suspect` when the scan flagged it. An existing row KEEPS its status, specialist and
 *  qualification; its listing fields (url, title, org, reward, deadline, posted, body,
 *  tags) are refreshed. A refreshed body that the scan now flags moves a `new` or
 *  `qualified` gig to `suspect` (both edges are in GIG_TRANSITIONS), and in every other
 *  status the reasons are recorded without a status move. A clean re-scan never clears
 *  reasons already recorded: un-suspecting is the operator's act (clearGigSuspect). */
export function upsertGigFromRaw(workspaceId: string, input: UpsertGigFromRawInput): { gig: Gig; created: boolean } {
  return upsertGigRow(workspaceId, {
    sourceId: input.sourceId,
    arena: input.arena,
    externalKey: input.raw.externalKey,
    url: input.raw.url,
    title: input.raw.title,
    org: input.raw.org,
    reward: input.raw.reward,
    deadlineAt: input.raw.deadlineAt,
    postedAt: input.raw.postedAt,
    bodyText: input.raw.bodyText,
    tags: input.raw.tags,
    suspectReasons: input.suspectReasons,
  });
}

export type CreateManualGigInput = {
  arena: GigArena;
  url: string;
  title: string;
  org: string | null;
  reward: GigReward | null;
  deadlineAt: string | null;
  bodyText: string;
  tags: readonly string[];
  suspectReasons: readonly GigSuspectReason[];
};

/** The external key of a forwarded brief: a hash of its normalized URL (fragment,
 *  trailing slashes and case dropped), or of its body when no URL was given - so the
 *  same brief forwarded twice resolves to the same row. */
export function gigManualExternalKey(url: string, bodyText: string): string {
  const normalized = url.trim().toLowerCase().replace(/#.*$/, "").replace(/\/+$/, "");
  const basis = normalized || `body:${bodyText.replace(/\s+/g, " ").trim().toLowerCase()}`;
  return `manual:${createHash("sha256").update(basis, "utf8").digest("hex").slice(0, 32)}`;
}

/** A brief the operator forwarded by hand (source_id NULL). Forwarding the same brief
 *  again refreshes the existing row exactly as a re-scan would (`created: false`). */
export function createManualGig(workspaceId: string, input: CreateManualGigInput): { gig: Gig; created: boolean } {
  return upsertGigRow(workspaceId, {
    sourceId: null,
    arena: input.arena,
    externalKey: gigManualExternalKey(input.url, input.bodyText),
    url: input.url.trim(),
    title: input.title,
    org: input.org,
    reward: input.reward,
    deadlineAt: input.deadlineAt,
    postedAt: null,
    bodyText: input.bodyText,
    tags: input.tags,
    suspectReasons: input.suspectReasons,
  });
}

type GigListingFields = {
  sourceId: string | null;
  arena: GigArena;
  externalKey: string;
  url: string;
  title: string;
  org: string | null;
  reward: GigReward | null;
  deadlineAt: string | null;
  postedAt: string | null;
  bodyText: string;
  tags: readonly string[];
  suspectReasons: readonly GigSuspectReason[];
};

/** Whether a stored reward is the listing's same reward, ignoring the USD estimate a scan
 *  attaches (`usd`, gigs/fx.ts): a new day's rate is not a changed listing. */
function sameListedReward(storedJson: string | null, next: GigReward | null): boolean {
  const strip = (r: GigReward | null): string | null => {
    if (!r) return null;
    const listed: GigReward = { ...r };
    delete listed.usd;
    return JSON.stringify(listed);
  };
  let stored: GigReward | null = null;
  try {
    stored = storedJson ? (JSON.parse(storedJson) as GigReward) : null;
  } catch {
    // An unreadable stored reward is a changed one: the upsert rewrites it.
    return false;
  }
  return strip(stored) === strip(next);
}

/** SELECT-then-write inside ONE IMMEDIATE transaction: the write lock is taken at BEGIN,
 *  so two scans of the same listing cannot both miss the row and both insert (the
 *  expression UNIQUE index would refuse the second anyway - this makes it a wait, not a
 *  thrown constraint). The lookup uses the index's own COALESCE expression. */
function upsertGigRow(workspaceId: string, f: GigListingFields): { gig: Gig; created: boolean } {
  const d = ensureDb();
  const reasons = uniqueReasons(f.suspectReasons);
  const title = cleanTitle(f.title);
  const tagsJson = JSON.stringify(cleanTags(f.tags));
  const rewardJson = f.reward ? JSON.stringify(f.reward) : null;
  const org = f.org?.trim() ? f.org.trim().slice(0, 200) : null;
  const run = d.transaction((): { id: string; created: boolean } => {
    const now = new Date().toISOString();
    // A scanned listing is ONE row per workspace whichever source found it: every adapter
    // namespaces its key (fl:, gh:, h1:, kaggle:, upwork:), so two sources whose filters
    // overlap - a query source and a skills source both returning Freelancer project 123 -
    // refresh the same row instead of filing it twice (78 projects were, before this). The row
    // keeps the source that first filed it. A forwarded brief keeps its own key space.
    const existing = (
      f.sourceId !== null
        ? d
            .prepare(
              `SELECT * FROM gigs
               WHERE workspace_id = ? AND source_id IS NOT NULL AND external_key = ?
               ORDER BY created_at ASC, rowid ASC LIMIT 1`
            )
            .get(workspaceId, f.externalKey)
        : d
            .prepare(
              `SELECT * FROM gigs
               WHERE workspace_id = ? AND source_id IS NULL AND external_key = ?`
            )
            .get(workspaceId, f.externalKey)
    ) as GigRow | undefined;
    if (!existing) {
      const id = randomId("gig");
      d.prepare(
        `INSERT INTO gigs
           (id, workspace_id, source_id, arena, external_key, url, title, org, reward_json, deadline_at, posted_at,
            body_text, tags_json, niche, status, suspect_reasons_json, specialist_id, qualification_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, NULL, ?, ?)`
      ).run(
        id,
        workspaceId,
        f.sourceId,
        f.arena,
        f.externalKey,
        f.url,
        title,
        org,
        rewardJson,
        f.deadlineAt,
        f.postedAt,
        f.bodyText,
        tagsJson,
        reasons.length > 0 ? "suspect" : "new",
        JSON.stringify(reasons),
        now,
        now
      );
      return { id, created: true };
    }
    const status: GigStatus = isGigStatus(existing.status) ? existing.status : "new";
    const prior = parseStringArray(existing.suspect_reasons_json, "gig.suspectReasons", existing.id).filter(isGigSuspectReason);
    const merged = uniqueReasons([...prior, ...reasons]);
    const nextStatus: GigStatus =
      reasons.length > 0 && (status === "new" || status === "qualified") && canTransitionGig(status, "suspect") ? "suspect" : status;
    const mergedJson = JSON.stringify(merged);
    // An identical re-scan writes nothing: updated_at is the desk's sort key, and an
    // hourly scan must not float every unchanged listing to the top.
    const unchanged =
      nextStatus === existing.status &&
      existing.url === f.url &&
      existing.title === title &&
      existing.org === org &&
      sameListedReward(existing.reward_json, f.reward) &&
      existing.deadline_at === f.deadlineAt &&
      existing.posted_at === f.postedAt &&
      existing.body_text === f.bodyText &&
      existing.tags_json === tagsJson &&
      existing.suspect_reasons_json === mergedJson;
    if (unchanged) {
      // The listing is the same; only the USD estimate a scan attaches (gigs/fx.ts, the rate
      // of the day) may have moved. Refresh it WITHOUT touching updated_at.
      if (existing.reward_json !== rewardJson) {
        d.prepare(`UPDATE gigs SET reward_json = ? WHERE id = ? AND workspace_id = ?`).run(rewardJson, existing.id, workspaceId);
      }
      return { id: existing.id, created: false };
    }
    d.prepare(
      `UPDATE gigs
       SET url = ?, title = ?, org = ?, reward_json = ?, deadline_at = ?, posted_at = ?, body_text = ?, tags_json = ?,
           suspect_reasons_json = ?, status = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ? AND status = ?`
    ).run(
      f.url,
      title,
      org,
      rewardJson,
      f.deadlineAt,
      f.postedAt,
      f.bodyText,
      tagsJson,
      mergedJson,
      nextStatus,
      now,
      existing.id,
      workspaceId,
      existing.status
    );
    return { id: existing.id, created: false };
  });
  const { id, created } = run.immediate();
  const gig = getGig(workspaceId, id);
  if (!gig) throw new Error(`gig ${id} vanished between its upsert and its read`);
  return { gig, created };
}

/** Fields a status move may write in the same statement. `undefined` = untouched,
 *  `null` = cleared. */
export type GigPatch = {
  specialistId?: string | null;
  qualification?: GigQualification | null;
  niche?: string | null;
  suspectReasons?: readonly GigSuspectReason[];
  /** Written by the operator's withdraw only (PATCH /api/gigs/[id]); null clears it. */
  withdrawReason?: GigWithdrawReason | null;
};

export type TransitionGigResult = { ok: true; gig: Gig } | { ok: false; reason: "not_found" | "stale" | "illegal" };

function patchColumns(patch: GigPatch | undefined): { sets: string[]; args: (string | null)[] } {
  const sets: string[] = [];
  const args: (string | null)[] = [];
  if (!patch) return { sets, args };
  if (patch.specialistId !== undefined) {
    sets.push("specialist_id = ?");
    args.push(patch.specialistId);
  }
  if (patch.qualification !== undefined) {
    sets.push("qualification_json = ?");
    args.push(patch.qualification === null ? null : JSON.stringify(patch.qualification));
  }
  if (patch.niche !== undefined) {
    sets.push("niche = ?");
    args.push(patch.niche?.trim() ? patch.niche.trim().slice(0, 120) : null);
  }
  if (patch.suspectReasons !== undefined) {
    sets.push("suspect_reasons_json = ?");
    args.push(JSON.stringify(uniqueReasons(patch.suspectReasons)));
  }
  if (patch.withdrawReason !== undefined) {
    sets.push("withdraw_reason_json = ?");
    args.push(patch.withdrawReason === null ? null : JSON.stringify(patch.withdrawReason));
  }
  return { sets, args };
}

/** Compare-and-swap status move. `illegal` (checked first, no read) when any `from`
 *  state lacks the edge to `to` in GIG_TRANSITIONS; `not_found` when the gig is not in
 *  this workspace; `stale` when its status is no longer one of `from` - the canonical
 *  shape for a decision computed during a long call (actOnPipelineEntry): the row moved,
 *  so the decision is dropped rather than applied to a state it was not made for. */
export function transitionGig(
  workspaceId: string,
  id: string,
  move: { from: GigStatus | readonly GigStatus[]; to: GigStatus; patch?: GigPatch }
): TransitionGigResult {
  const from = [...new Set(typeof move.from === "string" ? [move.from] : move.from)];
  if (from.length === 0 || !from.every((s) => canTransitionGig(s, move.to))) return { ok: false, reason: "illegal" };
  const d = ensureDb();
  const { sets, args } = patchColumns(move.patch);
  const fromPh = from.map(() => "?").join(", ");
  // Assembled OUTSIDE the SQL template: a nested template literal would split the
  // statement in the tenancy source guard's backtick scan.
  const setSql = sets.map((s) => ", " + s).join("");
  const run = d.transaction((): { ok: true } | { ok: false; reason: "not_found" | "stale" } => {
    const row = d.prepare(`SELECT status FROM gigs WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as
      | Pick<GigRow, "status">
      | undefined;
    if (!row) return { ok: false, reason: "not_found" };
    if (!(from as string[]).includes(row.status)) return { ok: false, reason: "stale" };
    const res = d
      .prepare(
        `UPDATE gigs SET status = ?, updated_at = ?${setSql}
         WHERE id = ? AND workspace_id = ? AND status IN (${fromPh})`
      )
      .run(move.to, new Date().toISOString(), ...args, id, workspaceId, ...from);
    return res.changes === 0 ? { ok: false, reason: "stale" } : { ok: true };
  });
  const result = run.immediate();
  if (!result.ok) return result;
  const gig = getGig(workspaceId, id);
  return gig ? { ok: true, gig } : { ok: false, reason: "not_found" };
}

/** Record the deterministic qualification verdict and the matched specialist (null =
 *  none available). Does NOT move status - the qualifier follows with
 *  transitionGig(new -> qualified | declined), so the verdict is stored even when the
 *  move turns out stale. Null when the gig is not in this workspace. */
export function setGigQualification(
  workspaceId: string,
  id: string,
  qualification: GigQualification,
  specialistId: string | null
): Gig | null {
  const res = ensureDb()
    .prepare(
      `UPDATE gigs SET qualification_json = ?, specialist_id = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`
    )
    .run(JSON.stringify(qualification), specialistId, new Date().toISOString(), id, workspaceId);
  return res.changes > 0 ? getGig(workspaceId, id) : null;
}

/** Route a gig: set its matched specialist and its niche WITHOUT moving status - a
 *  compare-and-swap on the status the caller read (gigs/routing.ts decides whether that
 *  status may be routed). `niche: null` clears the routing (auto-match again). One
 *  statement whose WHERE re-asserts the status, so a gig that moved meanwhile (a dispatch
 *  claimed it) is left alone and reported `stale`. */
export function setGigRoute(
  workspaceId: string,
  id: string,
  route: { expectedStatus: GigStatus; specialistId: string | null; niche: string | null }
): TransitionGigResult {
  const niche = route.niche?.trim() ? route.niche.trim().slice(0, 120) : null;
  const res = ensureDb()
    .prepare(
      `UPDATE gigs SET specialist_id = ?, niche = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ? AND status = ?`
    )
    .run(route.specialistId, niche, new Date().toISOString(), id, workspaceId, route.expectedStatus);
  const gig = getGig(workspaceId, id);
  if (!gig) return { ok: false, reason: "not_found" };
  return res.changes === 0 ? { ok: false, reason: "stale" } : { ok: true, gig };
}

/** The operator cleared the honeypot flag: suspect -> new, reasons emptied, in one CAS. */
export function clearGigSuspect(workspaceId: string, id: string): TransitionGigResult {
  return transitionGig(workspaceId, id, { from: "suspect", to: "new", patch: { suspectReasons: [] } });
}

// ---------------------------------------------------------------------------
// Research briefs (gigs/research.ts)
// ---------------------------------------------------------------------------

/** Statuses research still informs a decision in: before dispatch, and while a draft is
 *  in flight or under review. A gig that left the line (declined, withdrawn, expired) or
 *  was already judged is never researched by the scan - the on-demand door can still do it. */
export const GIG_RESEARCHABLE_STATUSES: readonly GigStatus[] = ["new", "suspect", "qualified", "dispatched", "drafted", "in_review"];

/** Store the research brief. `brief_at` is the brief's own clock; `updated_at` (the desk's
 *  sort key) is NOT touched - a brief annotates a listing, it does not move it. Null when
 *  the gig is not in this workspace. */
export function setGigBrief(workspaceId: string, id: string, brief: GigBrief): Gig | null {
  const res = ensureDb()
    .prepare(`UPDATE gigs SET brief_json = ?, brief_at = ? WHERE id = ? AND workspace_id = ?`)
    .run(JSON.stringify(brief), brief.createdAt, id, workspaceId);
  return res.changes > 0 ? getGig(workspaceId, id) : null;
}

// ---------------------------------------------------------------------------
// The gig's workspace (gigs/workdir.ts + gigs/project.ts)
// ---------------------------------------------------------------------------

/** Record the gig's folder and, when Personas registered it, the project rooted there.
 *  `personasProjectId: undefined` leaves the stored id alone (Personas unreachable says
 *  nothing about whether the project it registered earlier still exists); `null` clears it.
 *  Like the brief, this annotates the listing: `updated_at` (the desk's sort key) is NOT
 *  touched. Null when the gig is not in this workspace. */
export function setGigWorkspace(
  workspaceId: string,
  id: string,
  place: { workdir: string; personasProjectId?: string | null }
): Gig | null {
  const d = ensureDb();
  const res =
    place.personasProjectId === undefined
      ? d.prepare(`UPDATE gigs SET workdir = ? WHERE id = ? AND workspace_id = ?`).run(place.workdir, id, workspaceId)
      : d
          .prepare(`UPDATE gigs SET workdir = ?, personas_project_id = ? WHERE id = ? AND workspace_id = ?`)
          .run(place.workdir, place.personasProjectId, id, workspaceId);
  return res.changes > 0 ? getGig(workspaceId, id) : null;
}

/** Gigs with no brief yet, newest listing first, in a status research still informs.
 *  `sourceId` narrows to one source (a single-source scan researches its own listings).
 *  A stored deterministic brief counts as a brief: whether a provider answers NOW is not
 *  knowable from the row, so an upgrade is the operator's on-demand re-research, never a
 *  loop that re-spawns a keyless install every scan. */
export function listGigsNeedingBrief(workspaceId: string, limit: number, opts: { sourceId?: string | null } = {}): Gig[] {
  const n = Math.max(1, Math.min(50, Math.trunc(limit) || 1));
  const statuses = GIG_RESEARCHABLE_STATUSES;
  const statusPh = statuses.map(() => "?").join(", ");
  const bySource = typeof opts.sourceId === "string" && opts.sourceId !== "";
  const sourceSql = bySource ? " AND source_id = ?" : "";
  const args: (string | number)[] = [workspaceId, ...statuses];
  if (bySource) args.push(opts.sourceId as string);
  args.push(n);
  const rows = ensureDb()
    .prepare(
      `SELECT * FROM gigs
       WHERE workspace_id = ? AND brief_json IS NULL AND status IN (${statusPh})${sourceSql}
       ORDER BY created_at DESC, rowid DESC
       LIMIT ?`
    )
    .all(...args) as GigRow[];
  return rows.map(gigFromRow);
}

/** The most withdrawn gigs one read of the withdraw reasons walks (the newest). */
export const GIG_WITHDRAW_REASONS_MAX = 500;

/** The reasons the operator withdrew gigs for, newest first, as the scan's research reads
 *  them (gigs/withdraw-reasons.ts tallies them). Only rows that named a challenge. */
export function listGigWithdrawReasons(workspaceId: string, limit = GIG_WITHDRAW_REASONS_MAX): Pick<Gig, "withdrawReason">[] {
  const n = Math.max(1, Math.min(GIG_WITHDRAW_REASONS_MAX, Math.trunc(limit) || 1));
  const rows = ensureDb()
    .prepare(
      `SELECT id, withdraw_reason_json FROM gigs
       WHERE workspace_id = ? AND withdraw_reason_json IS NOT NULL
       ORDER BY updated_at DESC, rowid DESC
       LIMIT ?`
    )
    .all(workspaceId, n) as Pick<GigRow, "id" | "withdraw_reason_json">[];
  return rows.map((r) => ({ withdrawReason: withdrawReasonFromJson(r.withdraw_reason_json ?? null, r.id) })).filter((r) => r.withdrawReason !== null);
}

/** The most research briefs one arena aggregate reads (listGigBriefsForArena). */
export const GIG_ARENA_BRIEFS_MAX = 500;

/** One researched gig as the specialist requirements' research aggregate reads it. */
export type GigArenaBrief = { gigId: string; niche: string | null; brief: GigBrief };

/** The research briefs of one arena's gigs in this workspace, newest brief first, at most
 *  `limit` (1..GIG_ARENA_BRIEFS_MAX). A gig the honeypot scan flagged - held as `suspect`,
 *  or carrying reasons past it - is left out: its brief describes a lure, not the work the
 *  arena pays for (gigs/requirements.ts). Only the columns the aggregate reads. */
export function listGigBriefsForArena(workspaceId: string, arena: GigArena, limit: number = GIG_ARENA_BRIEFS_MAX): GigArenaBrief[] {
  const n = Math.max(1, Math.min(GIG_ARENA_BRIEFS_MAX, Math.trunc(limit) || GIG_ARENA_BRIEFS_MAX));
  const rows = ensureDb()
    .prepare(
      `SELECT id, niche, suspect_reasons_json, brief_json FROM gigs
       WHERE workspace_id = ? AND arena = ? AND brief_json IS NOT NULL AND status <> 'suspect'
       ORDER BY brief_at DESC, rowid DESC
       LIMIT ?`
    )
    .all(workspaceId, arena, n) as Pick<GigRow, "id" | "niche" | "suspect_reasons_json" | "brief_json">[];
  const out: GigArenaBrief[] = [];
  for (const row of rows) {
    if (parseStringArray(row.suspect_reasons_json, "gig.suspectReasons", row.id).some(isGigSuspectReason)) continue;
    const brief = briefFromJson(row.brief_json ?? null, row.id);
    if (brief) out.push({ gigId: row.id, niche: row.niche, brief });
  }
  return out;
}

/** Record honeypot reasons found AFTER the listing landed (on a page the listing linked
 *  to) without moving status: a gig past `qualified` keeps its place on the line and
 *  carries the reasons, exactly as upsertGigFromRaw records them on a re-scan. A `new` or
 *  `qualified` gig moves to `suspect` through transitionGig instead (gigs/research.ts).
 *  A compare-and-swap on the reasons read, so two writers cannot drop each other's.
 *  Null when the gig is not in this workspace. */
export function mergeGigSuspectReasons(workspaceId: string, id: string, reasons: readonly GigSuspectReason[]): Gig | null {
  const d = ensureDb();
  const run = d.transaction((): boolean => {
    const row = d.prepare(`SELECT suspect_reasons_json FROM gigs WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as
      | Pick<GigRow, "suspect_reasons_json">
      | undefined;
    if (!row) return false;
    const prior = parseStringArray(row.suspect_reasons_json, "gig.suspectReasons", id).filter(isGigSuspectReason);
    const merged = JSON.stringify(uniqueReasons([...prior, ...reasons]));
    if (merged === row.suspect_reasons_json) return true;
    d.prepare(
      `UPDATE gigs SET suspect_reasons_json = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ? AND suspect_reasons_json = ?`
    ).run(merged, new Date().toISOString(), id, workspaceId, row.suspect_reasons_json);
    return true;
  });
  return run.immediate() ? getGig(workspaceId, id) : null;
}

// ---------------------------------------------------------------------------
// Freshness (gigs/freshness.ts): is the listing still takeable on its source?
// ---------------------------------------------------------------------------

/** Record what the source answered. Like the brief, this annotates the listing: `updated_at`
 *  (the desk's sort key) is NOT touched. Null when the gig is not in this workspace. */
export function setGigSourceState(workspaceId: string, id: string, state: GigSourceState): Gig | null {
  const res = ensureDb()
    .prepare(`UPDATE gigs SET source_state_json = ?, freshness_checked_at = ? WHERE id = ? AND workspace_id = ?`)
    .run(JSON.stringify(state), state.checkedAt, id, workspaceId);
  return res.changes > 0 ? getGig(workspaceId, id) : null;
}

// ---------------------------------------------------------------------------
// The HTML report (gigs/report/*): where the file is and how current it is
// ---------------------------------------------------------------------------

/** Record the gig's report (gigs/report/run.ts): the file's path, the stage it was written
 *  at, its status (`writing` while a gig_report task runs) and provenance. Like the brief,
 *  this annotates the listing: `updated_at` (the desk's sort key) is NOT touched. Null when
 *  the gig is not in this workspace. */
export function setGigReport(workspaceId: string, id: string, report: GigReport): Gig | null {
  const res = ensureDb()
    .prepare(`UPDATE gigs SET report_json = ? WHERE id = ? AND workspace_id = ?`)
    .run(JSON.stringify(report), id, workspaceId);
  return res.changes > 0 ? getGig(workspaceId, id) : null;
}

/** Gigs of one key space (`keyPrefix`, e.g. "fl:") in the given statuses, least recently
 *  checked first (never-checked before any checked one), at most `limit` (1..500). Scanned
 *  rows only: a forwarded brief has no source to ask. */
export function listGigsForFreshness(
  workspaceId: string,
  opts: { keyPrefix: string; statuses: readonly GigStatus[]; limit: number }
): Gig[] {
  const statuses = opts.statuses.filter(isGigStatus);
  if (statuses.length === 0 || !/^[a-z0-9]{1,16}:$/.test(opts.keyPrefix)) return [];
  const n = Math.max(1, Math.min(500, Math.trunc(opts.limit) || 1));
  const statusPh = statuses.map(() => "?").join(", ");
  const rows = ensureDb()
    .prepare(
      `SELECT * FROM gigs
       WHERE workspace_id = ? AND source_id IS NOT NULL AND substr(external_key, 1, ?) = ? AND status IN (${statusPh})
       ORDER BY COALESCE(freshness_checked_at, '') ASC, created_at ASC, rowid ASC
       LIMIT ?`
    )
    .all(workspaceId, opts.keyPrefix.length, opts.keyPrefix, ...statuses, n) as GigRow[];
  return rows.map(gigFromRow);
}

// ---------------------------------------------------------------------------
// Duplicate rows (one listing filed by two sources before the upsert matched across them)
// ---------------------------------------------------------------------------

/** How far a gig has moved along the line: the copy that went furthest is the one kept. */
const GIG_PROGRESS_RANK: Readonly<Record<GigStatus, number>> = {
  accepted: 9,
  rejected: 9,
  sent: 8,
  in_review: 7,
  drafted: 6,
  dispatched: 5,
  qualified: 4,
  new: 3,
  suspect: 2,
  declined: 1,
  withdrawn: 1,
  expired: 0,
};

export type MergeDuplicateGigsResult = {
  /** Listing keys that had more than one scanned row. */
  groups: number;
  /** Redundant rows deleted (no attempt, outcome, plan, specialist or folder hung off them). */
  deleted: number;
  /** Redundant rows KEPT because work hangs off them - the operator's to resolve. */
  kept: { key: string; gigIds: string[] }[];
};

/** One scanned row per listing key: in every group of rows sharing a key, keep the copy that
 *  went furthest (then the one filed first) and delete each OTHER copy that nothing hangs off -
 *  no attempt, outcome, plan, gig persona or folder. A redundant copy with a brief the kept
 *  one lacks hands its brief over first. A copy with work is never deleted: it is reported
 *  in `kept`. One IMMEDIATE transaction per group. */
export function mergeDuplicateSourceGigs(workspaceId: string): MergeDuplicateGigsResult {
  const d = ensureDb();
  const keys = d
    .prepare(
      `SELECT external_key FROM gigs
       WHERE workspace_id = ? AND source_id IS NOT NULL
       GROUP BY external_key HAVING COUNT(*) > 1`
    )
    .all(workspaceId) as { external_key: string }[];
  const result: MergeDuplicateGigsResult = { groups: keys.length, deleted: 0, kept: [] };
  const hasWork = (id: string): boolean => {
    const one = (sql: string) => d.prepare(sql).get(workspaceId, id) !== undefined;
    return (
      one(`SELECT 1 FROM gig_attempts WHERE workspace_id = ? AND gig_id = ? LIMIT 1`) ||
      one(`SELECT 1 FROM gig_outcomes WHERE workspace_id = ? AND gig_id = ? LIMIT 1`) ||
      one(`SELECT 1 FROM gig_plans WHERE workspace_id = ? AND gig_id = ? LIMIT 1`) ||
      one(`SELECT 1 FROM gig_specialists WHERE workspace_id = ? AND gig_id = ? LIMIT 1`)
    );
  };
  for (const { external_key: key } of keys) {
    const run = d.transaction((): string[] => {
      const rows = d
        .prepare(
          `SELECT * FROM gigs WHERE workspace_id = ? AND source_id IS NOT NULL AND external_key = ?
           ORDER BY created_at ASC, rowid ASC`
        )
        .all(workspaceId, key) as GigRow[];
      if (rows.length < 2) return [];
      const rank = (r: GigRow) => (isGigStatus(r.status) ? GIG_PROGRESS_RANK[r.status] : 0) + (r.workdir || hasWork(r.id) ? 100 : 0);
      const keep = rows.reduce((best, r) => (rank(r) > rank(best) ? r : best), rows[0]);
      const stuck: string[] = [];
      for (const r of rows) {
        if (r.id === keep.id) continue;
        if (r.workdir || hasWork(r.id)) {
          stuck.push(r.id);
          continue;
        }
        if (!keep.brief_json && r.brief_json) {
          d.prepare(`UPDATE gigs SET brief_json = ?, brief_at = ? WHERE id = ? AND workspace_id = ? AND brief_json IS NULL`).run(
            r.brief_json,
            r.brief_at ?? null,
            keep.id,
            workspaceId
          );
          keep.brief_json = r.brief_json;
        }
        d.prepare(`DELETE FROM gigs WHERE id = ? AND workspace_id = ?`).run(r.id, workspaceId);
        result.deleted += 1;
      }
      return stuck;
    });
    const stuck = run.immediate();
    if (stuck.length > 0) result.kept.push({ key, gigIds: stuck });
  }
  return result;
}
