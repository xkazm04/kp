import { createHash } from "node:crypto";
import {
  isDismissReason,
  isKoReasonKey,
  isPostingStatus,
  isWorkMode,
  FIT_TIERS,
  SALARY_PERIODS,
  SUMMARY_SKILL_CAP,
  type DismissReason,
  type EligibilityFlag,
  type FitTier,
  type JobseekerPosting,
  type JobseekerPostingSummary,
  type PostingStatus,
  type RawPosting,
  type SalaryPeriod,
} from "../jobseeker/types";
import { randomId } from "../random-id";
import { ensureDb, safeRowParse } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";

// The reconciled posting dataset (app/_lib/jobseeker/types.ts): one row per real-world
// posting per source, keyed by (workspace, source, external_key) so a re-scan updates a
// row instead of duplicating it, and the match/deep-dive projections hang off that row.
//
// Tenancy: every statement binds `workspace_id = ?`, point reads included
// (jobseeker-postings-tenancy.test.ts). No carve-out.
//
// Lifecycle a scan drives:
//   upsertPosting  — new / changed (content hash moved) / unchanged (only last_seen_at)
//   markAbsent     — TWO consecutive misses before status = 'gone' (gone_at is the
//                    first-miss marker); a re-seen posting revives to 'new'.
// The seeker drives status otherwise (shortlisted / applied / dismissed).

type PostingRow = {
  id: string;
  workspace_id: string;
  source_id: string;
  external_key: string;
  url: string;
  title: string;
  company: string | null;
  location: string | null;
  country: string | null;
  work_mode: string | null;
  posted_at: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: string | null;
  body_text: string;
  jsonld_json: string | null;
  content_hash: string;
  job_json: string | null;
  job_source: string | null;
  match_json: string | null;
  match_total: number | null;
  fit_tier: string | null;
  match_version: string | null;
  matched_at: string | null;
  reasoning_json: string | null;
  status: string;
  dismiss_reason: string | null;
  dismiss_note: string | null;
  applied_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  gone_at: string | null;
};

/** The list projection: no body, no JSON-LD, no structured job, no reasoning — only
 *  match_json rides along because eligibility/confidence are read out of it. */
type SummaryRow = Omit<PostingRow, "body_text" | "jsonld_json" | "job_json" | "reasoning_json" | "content_hash"> & {
  body_chars: number;
  deep_dived: number;
};

const SUMMARY_COLUMNS = `id, workspace_id, source_id, external_key, url, title, company, location, country, work_mode,
     posted_at, salary_min, salary_max, salary_currency, salary_period, match_json, match_total, fit_tier,
     match_version, matched_at, job_source, status, dismiss_reason, dismiss_note, applied_at, first_seen_at, last_seen_at, gone_at,
     LENGTH(body_text) AS body_chars, (reasoning_json IS NOT NULL) AS deep_dived`;

function coerceFitTier(value: string | null): FitTier | null {
  return value !== null && (FIT_TIERS as readonly string[]).includes(value) ? (value as FitTier) : null;
}

function coerceSalaryPeriod(value: string | null): SalaryPeriod | null {
  return value !== null && (SALARY_PERIODS as readonly string[]).includes(value) ? (value as SalaryPeriod) : null;
}

function coerceJobSource(value: string | null): "deterministic" | "llm" | null {
  return value === "deterministic" || value === "llm" ? value : null;
}

/** The columns shared by the full row and the summary row. */
function baseFromRow(row: PostingRow | SummaryRow) {
  return {
    id: row.id,
    sourceId: row.source_id,
    externalKey: row.external_key,
    url: row.url,
    title: row.title,
    company: row.company,
    location: row.location,
    country: row.country,
    workMode: isWorkMode(row.work_mode) ? row.work_mode : null,
    postedAt: row.posted_at,
    salaryMin: row.salary_min,
    salaryMax: row.salary_max,
    salaryCurrency: row.salary_currency,
    salaryPeriod: coerceSalaryPeriod(row.salary_period),
    jobSource: coerceJobSource(row.job_source),
    matchTotal: row.match_total,
    fitTier: coerceFitTier(row.fit_tier),
    matchVersion: row.match_version,
    matchedAt: row.matched_at,
    status: isPostingStatus(row.status) ? row.status : "new",
    dismissReason: isDismissReason(row.dismiss_reason) ? row.dismiss_reason : null,
    dismissNote: row.dismiss_note,
    appliedAt: row.applied_at,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    goneAt: row.gone_at,
  };
}

function parseMatch(json: string | null, id: string): Record<string, unknown> | null {
  const match = safeRowParse<Record<string, unknown>>(json, "jobseekerPosting.match", id);
  return match && typeof match === "object" ? match : null;
}

function fromRow(row: PostingRow): JobseekerPosting {
  const jsonld = safeRowParse<Record<string, unknown>>(row.jsonld_json, "jobseekerPosting.jsonld", row.id);
  const job = safeRowParse<Record<string, unknown>>(row.job_json, "jobseekerPosting.job", row.id);
  const reasoning = safeRowParse<Record<string, unknown>>(row.reasoning_json, "jobseekerPosting.reasoning", row.id);
  return {
    ...baseFromRow(row),
    bodyText: row.body_text,
    jsonld: jsonld && typeof jsonld === "object" ? jsonld : null,
    contentHash: row.content_hash,
    job: job && typeof job === "object" ? job : null,
    match: parseMatch(row.match_json, row.id),
    reasoning: reasoning && typeof reasoning === "object" ? reasoning : null,
  };
}

/** The gates a KO verdict names (setPostingBlocked's `{blocked: {koKeys}}`), filtered to
 *  the known vocabulary; [] for a scored row, a never-matched one, or an unreadable payload. */
function projectBlockedBy(match: Record<string, unknown> | null): JobseekerPostingSummary["blockedBy"] {
  const blocked = match?.blocked;
  if (!blocked || typeof blocked !== "object") return [];
  const keys = (blocked as { koKeys?: unknown }).koKeys;
  return Array.isArray(keys) ? keys.filter(isKoReasonKey) : [];
}

/** Eligibility + confidence are PROJECTIONS of the stored MatchResult: read defensively,
 *  because the match schema is the pipeline's (codegen) and this store must not break
 *  when a field is renamed there — an unreadable projection is empty, never a throw. A
 *  blocked row's payload is `{blocked, asIf}`, so its own eligibility/confidence read
 *  empty: the as-if flags describe a score the posting does not have. */
function projectMatch(
  match: Record<string, unknown> | null
): Pick<JobseekerPostingSummary, "eligibility" | "confidence" | "blockedBy" | "blockedDetails" | "asIfTotal" | "matchedSkills" | "missingSkills"> {
  const eligibility = Array.isArray(match?.eligibility) ? (match.eligibility as EligibilityFlag[]) : [];
  const raw = match?.confidence;
  const confidence =
    raw && typeof raw === "object" && typeof (raw as { low?: unknown }).low === "number" && typeof (raw as { high?: unknown }).high === "number"
      ? (raw as JobseekerPostingSummary["confidence"])
      : null;
  const blockedBy = projectBlockedBy(match);
  // A filtered row's skills and as-if score live under `asIf`: they describe a score the
  // posting does not have, so they ride as the as-if figure only, never as its skills.
  const asIf = blockedBy.length > 0 && match?.asIf && typeof match.asIf === "object" ? (match.asIf as Record<string, unknown>) : null;
  const asIfTotal = asIf && typeof asIf.total === "number" && Number.isFinite(asIf.total) ? asIf.total : null;
  const scored = blockedBy.length === 0 ? match : null;
  return {
    eligibility,
    confidence,
    blockedBy,
    blockedDetails: blockedBy.length > 0 ? projectBlockedDetails(match) : [],
    asIfTotal,
    matchedSkills: projectMatchedSkills(scored),
    missingSkills: projectStrings(scored?.missingSkills, SUMMARY_SKILL_CAP),
  };
}

/** The engine's sentence per gate, kept only beside a key the vocabulary knows (index-aligned). */
function projectBlockedDetails(match: Record<string, unknown> | null): string[] {
  const blocked = match?.blocked as { koKeys?: unknown; koDetails?: unknown } | undefined;
  const keys = Array.isArray(blocked?.koKeys) ? blocked.koKeys : [];
  const details = Array.isArray(blocked?.koDetails) ? blocked.koDetails : [];
  return details.filter((d, i): d is string => typeof d === "string" && d.trim() !== "" && isKoReasonKey(keys[i])).slice(0, 5);
}

function projectStrings(v: unknown, cap: number): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, cap) : [];
}

/** The matched skills with the provenance of the seeker's claim (`matchedSkillProvenance`),
 *  so a card can draw a stated-only claim differently from one done at work. */
function projectMatchedSkills(match: Record<string, unknown> | null): JobseekerPostingSummary["matchedSkills"] {
  const skills = projectStrings(match?.matchedSkills, SUMMARY_SKILL_CAP);
  const prov = match?.matchedSkillProvenance && typeof match.matchedSkillProvenance === "object" ? (match.matchedSkillProvenance as Record<string, unknown>) : {};
  return skills.map((skill) => ({ skill, provenance: typeof prov[skill] === "string" ? (prov[skill] as string) : null }));
}

function fromSummaryRow(row: SummaryRow): JobseekerPostingSummary {
  return {
    ...baseFromRow(row),
    ...projectMatch(parseMatch(row.match_json, row.id)),
    bodyChars: row.body_chars,
    deepDived: row.deep_dived === 1,
  };
}

/** Same normalization as job-postings.ts: whitespace and case are not content, so a
 *  board that re-renders its template does not register every posting as changed. */
export function postingContentHash(bodyText: string): string {
  return createHash("sha256").update(bodyText.replace(/\s+/g, " ").trim().toLowerCase(), "utf8").digest("hex");
}

export type UpsertOutcome = "new" | "changed" | "unchanged";

/** The salary columns from RawPosting.salary — what the ADAPTER parsed (JSON-LD
 *  baseSalary, a feed's structured pay), or all null when the posting did not state
 *  pay. The store never derives a figure from salaryText: unknown stays unknown. */
function salaryColumns(raw: RawPosting): [number | null, number | null, string | null, SalaryPeriod | null] {
  const s = raw.salary;
  if (!s || (s.min === null && s.max === null) || !s.currency || !(SALARY_PERIODS as readonly string[]).includes(s.period)) {
    return [null, null, null, null];
  }
  return [s.min, s.max, s.currency.toUpperCase().slice(0, 8), s.period];
}

/** Reconcile one raw posting into the dataset. `unchanged` bumps last_seen_at only;
 *  `changed` (a moved content hash) rewrites the content columns and clears the
 *  structured job + match so the matcher re-scores it; a posting the scan had marked
 *  gone (or was on its first miss) is revived either way. The salary columns are the
 *  adapter's parse of the posting (RawPosting.salary), written with the content. */
export function upsertPosting(
  sourceId: string,
  raw: RawPosting,
  seenAt: string,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): { id: string; outcome: UpsertOutcome } {
  const d = ensureDb();
  const contentHash = postingContentHash(raw.bodyText);
  const [salaryMin, salaryMax, salaryCurrency, salaryPeriod] = salaryColumns(raw);
  const run = d.transaction((): { id: string; outcome: UpsertOutcome } => {
    const existing = d
      .prepare(
        `SELECT id, content_hash, status FROM jobseeker_postings
         WHERE source_id = ? AND external_key = ? AND workspace_id = ?`
      )
      .get(sourceId, raw.externalKey, workspaceId) as Pick<PostingRow, "id" | "content_hash" | "status"> | undefined;
    if (!existing) {
      const id = randomId("jpo");
      d.prepare(
        `INSERT INTO jobseeker_postings
           (id, workspace_id, source_id, external_key, url, title, company, location, country, work_mode, posted_at,
            salary_min, salary_max, salary_currency, salary_period,
            body_text, jsonld_json, content_hash, status, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`
      ).run(
        id,
        workspaceId,
        sourceId,
        raw.externalKey,
        raw.url,
        raw.title.trim().slice(0, 300) || "Untitled posting",
        raw.company,
        raw.location,
        raw.country,
        raw.workMode,
        raw.postedAt,
        salaryMin,
        salaryMax,
        salaryCurrency,
        salaryPeriod,
        raw.bodyText,
        raw.jsonld ? JSON.stringify(raw.jsonld) : null,
        contentHash,
        seenAt,
        seenAt
      );
      return { id, outcome: "new" };
    }
    // A seen posting is present, whatever the scan had concluded before: the first-miss
    // marker clears, and a 'gone' row comes back as 'new' (the seeker's own statuses —
    // shortlisted / applied / dismissed — are untouched).
    const revive = `status = CASE WHEN status = 'gone' THEN 'new' ELSE status END, gone_at = NULL`;
    if (existing.content_hash === contentHash) {
      d.prepare(`UPDATE jobseeker_postings SET last_seen_at = ?, ${revive} WHERE id = ? AND workspace_id = ?`).run(
        seenAt,
        existing.id,
        workspaceId
      );
      return { id: existing.id, outcome: "unchanged" };
    }
    d.prepare(
      `UPDATE jobseeker_postings
       SET url = ?, title = ?, company = ?, location = ?, country = ?, work_mode = ?, posted_at = ?,
           salary_min = ?, salary_max = ?, salary_currency = ?, salary_period = ?,
           body_text = ?, jsonld_json = ?, content_hash = ?,
           job_json = NULL, job_source = NULL, match_json = NULL, match_total = NULL, fit_tier = NULL,
           match_version = NULL, matched_at = NULL, reasoning_json = NULL,
           last_seen_at = ?, ${revive}
       WHERE id = ? AND workspace_id = ?`
    ).run(
      raw.url,
      raw.title.trim().slice(0, 300) || "Untitled posting",
      raw.company,
      raw.location,
      raw.country,
      raw.workMode,
      raw.postedAt,
      salaryMin,
      salaryMax,
      salaryCurrency,
      salaryPeriod,
      raw.bodyText,
      raw.jsonld ? JSON.stringify(raw.jsonld) : null,
      contentHash,
      seenAt,
      existing.id,
      workspaceId
    );
    return { id: existing.id, outcome: "changed" };
  });
  return run.immediate();
}

/** After a source's scan: every posting of the source NOT seen in it (last_seen_at
 *  before the scan started) takes one step toward gone. First miss stamps gone_at;
 *  a second consecutive miss sets status = 'gone'. Returns how many moved to gone.
 *  Two statements in one IMMEDIATE transaction, second-miss FIRST — otherwise the
 *  first-miss stamp written a moment earlier would count as the second. */
export function markAbsent(sourceId: string, seenBefore: string, workspaceId: string = DEFAULT_WORKSPACE_ID): number {
  const d = ensureDb();
  const now = new Date().toISOString();
  const run = d.transaction((): number => {
    const gone = d
      .prepare(
        `UPDATE jobseeker_postings SET status = 'gone'
         WHERE source_id = ? AND workspace_id = ? AND last_seen_at < ? AND gone_at IS NOT NULL AND status != 'gone'`
      )
      .run(sourceId, workspaceId, seenBefore);
    d.prepare(
      `UPDATE jobseeker_postings SET gone_at = ?
       WHERE source_id = ? AND workspace_id = ? AND last_seen_at < ? AND gone_at IS NULL`
    ).run(now, sourceId, workspaceId, seenBefore);
    return gone.changes;
  });
  return run.immediate();
}

/** The structured Job the extractor produced (deterministic or LLM). */
export function setPostingStructure(
  id: string,
  job: Record<string, unknown>,
  jobSource: "deterministic" | "llm",
  workspaceId: string = DEFAULT_WORKSPACE_ID
): boolean {
  const res = ensureDb()
    .prepare(`UPDATE jobseeker_postings SET job_json = ?, job_source = ? WHERE id = ? AND workspace_id = ?`)
    .run(JSON.stringify(job), jobSource, id, workspaceId);
  return res.changes > 0;
}

/** The MatchResult verbatim plus its indexed projection — written together so the sort
 *  column and the payload can never disagree. */
export function setPostingMatch(
  id: string,
  match: Record<string, unknown>,
  projection: { total: number; fitTier: FitTier; version: string; matchedAt: string },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): boolean {
  const res = ensureDb()
    .prepare(
      `UPDATE jobseeker_postings SET match_json = ?, match_total = ?, fit_tier = ?, match_version = ?, matched_at = ?
       WHERE id = ? AND workspace_id = ?`
    )
    .run(JSON.stringify(match), projection.total, projection.fitTier, projection.version, projection.matchedAt, id, workspaceId);
  return res.changes > 0;
}

/** A KO verdict: the posting failed the matcher's hard filter. Stored in match_json as
 *  `{blocked: {koKeys, koDetails}, asIf: <MatchResult>}` with match_total and fit_tier
 *  NULL — sorting, the minTotal filter and the deep-dive shortlist all read match_total,
 *  so an as-if score can never rank — and STAMPED with the matcher version and time, so
 *  listPostingsForMatching's skip predicate treats it as current until the posting or
 *  the profile moves.
 *
 *  Re-check, not lock: the verdict was computed from the job_json the scan listed, and a
 *  content change since then (upsertPosting) NULLs job_json. `AND job_json IS NOT NULL`
 *  makes that a `changes === 0` skip, so a stale verdict is never stamped over new
 *  content; the row stays unmatched and the next scan structures and matches it. */
export function setPostingBlocked(
  id: string,
  verdict: { blocked: { koKeys: string[]; koDetails: string[] }; asIf: Record<string, unknown> },
  projection: { version: string; matchedAt: string },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): boolean {
  const res = ensureDb()
    .prepare(
      `UPDATE jobseeker_postings SET match_json = ?, match_total = NULL, fit_tier = NULL, match_version = ?, matched_at = ?
       WHERE id = ? AND workspace_id = ? AND job_json IS NOT NULL`
    )
    .run(JSON.stringify(verdict), projection.version, projection.matchedAt, id, workspaceId);
  return res.changes > 0;
}

export function setPostingReasoning(id: string, reasoning: Record<string, unknown>, workspaceId: string = DEFAULT_WORKSPACE_ID): boolean {
  const res = ensureDb()
    .prepare(`UPDATE jobseeker_postings SET reasoning_json = ? WHERE id = ? AND workspace_id = ?`)
    .run(JSON.stringify(reasoning), id, workspaceId);
  return res.changes > 0;
}

/** The seeker's own status move. `dismiss` is required by shape when the status is
 *  'dismissed' (the reason is what the feed learns from); any other status clears it.
 *
 *  `applied_at` follows the status in the SAME statement: it is stamped when the row
 *  becomes 'applied' and cleared when it leaves (a restored row did not apply). COALESCE
 *  keeps the FIRST stamp — re-sending 'applied' for a row that already is must not
 *  rewrite the date the seeker acted. */
export function setJobseekerPostingStatus(
  id: string,
  status: PostingStatus,
  dismiss: { reason: DismissReason; note: string | null } | null,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): boolean {
  const applied = status === "dismissed" ? dismiss : null;
  const res = ensureDb()
    .prepare(
      `UPDATE jobseeker_postings
       SET status = ?, dismiss_reason = ?, dismiss_note = ?,
           applied_at = CASE WHEN ? = 'applied' THEN COALESCE(applied_at, ?) ELSE NULL END
       WHERE id = ? AND workspace_id = ?`
    )
    .run(
      status,
      applied?.reason ?? null,
      applied?.note?.trim() ? applied.note.trim().slice(0, 1000) : null,
      status,
      new Date().toISOString(),
      id,
      workspaceId
    );
  return res.changes > 0;
}

/** How many LIVE postings arrived after the seeker's feed anchor — the derived half of
 *  "new since your last visit". ONE comparison over the same ordering tuple the keyset
 *  pager uses, `(first_seen_at, id) > (anchor.at, anchor.id)`, so the count and the
 *  divider can never disagree about which row is the boundary. No counter is maintained
 *  anywhere; there is nothing to drift. */
export function countJobseekerPostingsNewSince(
  anchor: { at: string; id: string },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): number {
  const row = ensureDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM jobseeker_postings
       WHERE workspace_id = ? AND status NOT IN ('dismissed', 'gone')
         AND (first_seen_at > ? OR (first_seen_at = ? AND id > ?))`
    )
    .get(workspaceId, anchor.at, anchor.at, anchor.id) as { n: number };
  return row.n;
}

export function getJobseekerPosting(id: string, workspaceId: string = DEFAULT_WORKSPACE_ID): JobseekerPosting | null {
  const row = ensureDb()
    .prepare(`SELECT * FROM jobseeker_postings WHERE id = ? AND workspace_id = ?`)
    .get(id, workspaceId) as PostingRow | undefined;
  return row ? fromRow(row) : null;
}

export type ListPostingsOptions = {
  /** One status, or `all` for every row (the /me sieve draws decided and gone rows too);
   *  absent = the LIVE feed. */
  status?: PostingStatus | "all";
  minTotal?: number;
  sourceId?: string;
  sort?: "total" | "posted" | "seen";
  limit?: number;
  cursor?: string | null;
};

// Keyset paging. The cursor is the (sort key, id) pair of the last row handed out,
// base64url-encoded so the client treats it as opaque; a page never repeats or skips a
// row when postings land between requests, which an OFFSET pager cannot promise while
// a scan is writing. Sort keys are nullable (unmatched rows have no total, feeds often
// omit posted_at), so nulls sort LAST and the cursor carries an explicit null.
type CursorPayload = { k: string | number | null; id: string };

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | null | undefined): CursorPayload | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<CursorPayload>;
    if (typeof parsed.id !== "string") return null;
    const k = parsed.k;
    return { k: typeof k === "string" || typeof k === "number" ? k : null, id: parsed.id };
  } catch {
    // A malformed cursor is a client error, not a crash: the list starts from the top.
    return null;
  }
}

const SORT_COLUMN: Record<NonNullable<ListPostingsOptions["sort"]>, string> = {
  total: "match_total",
  posted: "posted_at",
  seen: "last_seen_at",
};

export function listJobseekerPostings(
  opts: ListPostingsOptions = {},
  workspaceId: string = DEFAULT_WORKSPACE_ID
): { rows: JobseekerPostingSummary[]; nextCursor: string | null } {
  const limit = Math.max(1, Math.min(200, Math.trunc(opts.limit ?? 50) || 50));
  const sort = opts.sort ?? "total";
  const col = SORT_COLUMN[sort];
  // The tenant predicate is LITERAL in the SQL below, never assembled into `clauses`
  // (job-postings.ts: a scoping the source guard cannot see is not a scoping).
  const clauses: string[] = [];
  const args: (string | number)[] = [workspaceId];
  if (opts.status === "all") {
    // Every row: the sieve counts what the seeker decided and what went away.
  } else if (opts.status) {
    clauses.push("status = ?");
    args.push(opts.status);
  } else {
    // The default feed is the LIVE one: what the seeker can still act on.
    clauses.push("status NOT IN ('dismissed', 'gone')");
  }
  if (typeof opts.minTotal === "number" && Number.isFinite(opts.minTotal)) {
    clauses.push("match_total >= ?");
    args.push(opts.minTotal);
  }
  if (opts.sourceId) {
    clauses.push("source_id = ?");
    args.push(opts.sourceId);
  }
  const cursor = decodeCursor(opts.cursor);
  if (cursor) {
    if (cursor.k === null) {
      // Already inside the null tail: only the id order remains.
      clauses.push(`${col} IS NULL AND id < ?`);
      args.push(cursor.id);
    } else {
      // Rows strictly after (k DESC, id DESC): a smaller key, the same key with a smaller
      // id, or the null tail that sorts after every non-null key.
      clauses.push(`(${col} < ? OR (${col} = ? AND id < ?) OR ${col} IS NULL)`);
      args.push(cursor.k, cursor.k, cursor.id);
    }
  }
  args.push(limit + 1);
  const rows = ensureDb()
    .prepare(
      `SELECT ${SUMMARY_COLUMNS} FROM jobseeker_postings
       WHERE workspace_id = ? ${clauses.map((c) => `AND ${c}`).join(" ")}
       ORDER BY (${col} IS NULL) ASC, ${col} DESC, id DESC
       LIMIT ?`
    )
    .all(...args) as SummaryRow[];
  const page = rows.slice(0, limit);
  const last = rows.length > limit ? page[page.length - 1] : null;
  const nextCursor = last
    ? encodeCursor({
        k: sort === "total" ? last.match_total : sort === "posted" ? last.posted_at : last.last_seen_at,
        id: last.id,
      })
    : null;
  return { rows: page.map(fromSummaryRow), nextCursor };
}

/** The summary projection of ONE posting — what a write door hands back (PATCH, the
 *  deep-dive) so the feed row can be replaced in place without a second list fetch. */
export function getPostingSummary(id: string, workspaceId: string = DEFAULT_WORKSPACE_ID): JobseekerPostingSummary | null {
  const row = ensureDb()
    .prepare(`SELECT ${SUMMARY_COLUMNS} FROM jobseeker_postings WHERE id = ? AND workspace_id = ?`)
    .get(id, workspaceId) as SummaryRow | undefined;
  return row ? fromSummaryRow(row) : null;
}

/** The RawPosting the structurer reads, rebuilt from the row: the scan structures a
 *  posting AFTER reconciliation (one batch spawn, not one per upsert), so the adapter's
 *  RawPosting is gone by then. `salaryText` and `lang` are not persisted — the
 *  deterministic structurer reads `salary` (the adapter's parse) and the body. */
function rawFromRow(row: PostingRow): RawPosting {
  const jsonld = safeRowParse<Record<string, unknown>>(row.jsonld_json, "jobseekerPosting.jsonld", row.id);
  const period = coerceSalaryPeriod(row.salary_period);
  return {
    externalKey: row.external_key,
    url: row.url,
    title: row.title,
    company: row.company,
    location: row.location,
    country: row.country,
    workMode: isWorkMode(row.work_mode) ? row.work_mode : null,
    postedAt: row.posted_at,
    salaryText: null,
    salary:
      row.salary_currency && period && (row.salary_min !== null || row.salary_max !== null)
        ? { min: row.salary_min, max: row.salary_max, currency: row.salary_currency, period }
        : null,
    bodyText: row.body_text,
    jsonld: jsonld && typeof jsonld === "object" ? jsonld : null,
    lang: null,
  };
}

/** What the structurer still owes a Job: live postings with no job_json (new since the
 *  last scan, or changed — upsertPosting clears the structure on a moved content hash). */
export function listPostingsNeedingStructure(workspaceId: string = DEFAULT_WORKSPACE_ID): { id: string; raw: RawPosting }[] {
  const rows = ensureDb()
    .prepare(
      `SELECT * FROM jobseeker_postings
       WHERE workspace_id = ? AND job_json IS NULL AND status NOT IN ('dismissed', 'gone')
       ORDER BY first_seen_at DESC, id DESC`
    )
    .all(workspaceId) as PostingRow[];
  return rows.map((row) => ({ id: row.id, raw: rawFromRow(row) }));
}

/** The deep-dive shortlist: scored at or above the seeker's threshold, still live, not
 *  yet reasoned about — best first, capped at the policy's per-scan maximum. */
export function listDeepDiveCandidates(
  opts: { threshold: number; limit: number },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): JobseekerPosting[] {
  const rows = ensureDb()
    .prepare(
      `SELECT * FROM jobseeker_postings
       WHERE workspace_id = ? AND match_total >= ? AND reasoning_json IS NULL AND status NOT IN ('dismissed', 'gone')
       ORDER BY match_total DESC, id DESC
       LIMIT ?`
    )
    .all(workspaceId, opts.threshold, Math.max(0, Math.trunc(opts.limit))) as PostingRow[];
  return rows.map(fromRow);
}

/** Skip predicate for the matcher: a row whose stored score is still the truth.
 *
 *  Both halves must hold — the score was written by THIS matcher version AND after the
 *  seeker last changed their profile/preferences. Everything else comes back: never
 *  matched, matched under an older version, matched before the profile moved, or nulled
 *  by upsertPosting when the posting's content changed. NULL-safe by construction: a
 *  `NOT (match_version = ?)` over a NULL column yields NULL and would silently drop the
 *  never-matched rows, which is why the predicate is written as an OR of positive
 *  "still owes a score" cases. */
export type MatchingScope = {
  /** MATCH_VERSION (match.ts) — a row stamped with anything else is re-scored. */
  upToDateVersion: string;
  /** The profile's `updatedAt`: a score older than the inputs is not a score. */
  profileUpdatedAt: string;
};

/** What the matcher scores: the structured, still-live postings of the workspace whose
 *  stored match is stale (or absent). `skippedUpToDate` is what the scan reports as work
 *  it did NOT redo — counted with the mirrored predicate, so the number and the rows
 *  partition the same live set. Without a scope every live row is returned (the
 *  pre-incremental behaviour) and `skippedUpToDate` is 0. Every statement writes its own
 *  literal `workspace_id = ?` (the source guard reads the SQL, not a shared constant). */
export function listPostingsForMatching(
  workspaceId: string = DEFAULT_WORKSPACE_ID,
  scope?: MatchingScope
): { rows: { id: string; job: Record<string, unknown> }[]; skippedUpToDate: number } {
  const d = ensureDb();
  const rows = (
    scope
      ? d
          .prepare(
            `SELECT id, job_json FROM jobseeker_postings
             WHERE workspace_id = ? AND job_json IS NOT NULL AND status NOT IN ('dismissed', 'gone')
               AND (match_version IS NULL OR match_version != ? OR matched_at IS NULL OR matched_at < ?)
             ORDER BY first_seen_at DESC, id DESC`
          )
          .all(workspaceId, scope.upToDateVersion, scope.profileUpdatedAt)
      : d
          .prepare(
            `SELECT id, job_json FROM jobseeker_postings
             WHERE workspace_id = ? AND job_json IS NOT NULL AND status NOT IN ('dismissed', 'gone')
             ORDER BY first_seen_at DESC, id DESC`
          )
          .all(workspaceId)
  ) as Pick<PostingRow, "id" | "job_json">[];
  const skippedUpToDate = scope
    ? (
        d
          .prepare(
            `SELECT COUNT(*) AS n FROM jobseeker_postings
             WHERE workspace_id = ? AND job_json IS NOT NULL AND status NOT IN ('dismissed', 'gone')
               AND match_version = ? AND matched_at >= ?`
          )
          .get(workspaceId, scope.upToDateVersion, scope.profileUpdatedAt) as { n: number }
      ).n
    : 0;
  const out: { id: string; job: Record<string, unknown> }[] = [];
  for (const row of rows) {
    const job = safeRowParse<Record<string, unknown>>(row.job_json, "jobseekerPosting.job", row.id);
    if (job && typeof job === "object") out.push({ id: row.id, job });
  }
  return { rows: out, skippedUpToDate };
}
