import { createHash } from "node:crypto";
import { canTransitionGig } from "../gigs/transitions";
import {
  isGigArena,
  isGigStatus,
  isGigSuspectReason,
  type Gig,
  type GigArena,
  type GigQualification,
  type GigReward,
  type GigStatus,
  type GigSuspectReason,
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
    const existing = d
      .prepare(
        `SELECT * FROM gigs
         WHERE workspace_id = ? AND COALESCE(source_id, 'manual') = COALESCE(?, 'manual') AND external_key = ?`
      )
      .get(workspaceId, f.sourceId, f.externalKey) as GigRow | undefined;
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
      existing.reward_json === rewardJson &&
      existing.deadline_at === f.deadlineAt &&
      existing.posted_at === f.postedAt &&
      existing.body_text === f.bodyText &&
      existing.tags_json === tagsJson &&
      existing.suspect_reasons_json === mergedJson;
    if (unchanged) return { id: existing.id, created: false };
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

/** The operator cleared the honeypot flag: suspect -> new, reasons emptied, in one CAS. */
export function clearGigSuspect(workspaceId: string, id: string): TransitionGigResult {
  return transitionGig(workspaceId, id, { from: "suspect", to: "new", patch: { suspectReasons: [] } });
}
