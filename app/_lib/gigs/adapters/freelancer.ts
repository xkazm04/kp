// freelancer_api: active Freelancer.com projects, via the public Projects API.
//
//   GET https://www.freelancer.com/api/projects/0.1/projects/active/
//       ?full_description=true&job_details=true&compact=true&limit=N&offset=0[&query=..][&jobs[]=..]
//
// Keyless (measured 2026-09-24: 200 without a token, and robots.txt does not disallow
// /api/). Tier B all the same: the API terms bind the operator's account, so the store
// keeps the source disabled until the operator acknowledged them.
//
// Reward: `budget {minimum, maximum}` in `currency {code, sign}`. The amount is the
// MINIMUM (the figure the client has committed to - quoting the ceiling would overstate
// the gig), and `text` keeps the stated range; an hourly project says "/hr". No budget
// -> `reward: null`.
//
// Config (never a secret): `query` (free-text search), `jobs` (Freelancer skill ids).
//
// TEST SEAM (e2e/gig-lifecycle.spec.ts): `KP_GIGS_FREELANCER_API_BASE`, read through the
// adapter's env door at call time, points the list call at a LOCAL fixture server
// (`http://127.0.0.1:<port>`) so the real scan runs end to end with no network. Honoured only
// for a loopback origin (127.0.0.1, localhost, [::1]); any other value is ignored and the real
// host is used, so the variable can never aim a scan at a third party. Unset (the default):
// unchanged. Listing URLs keep the real host either way.

import type { GigReward, GigSourceState, GigSourceStateName, RawGig } from "../types";
import { cfgList, cfgListAll, clipBody, isoOrNull, mustOk, num, parseJsonBody, str } from "./shared";
import { AdapterCollapsed, type GigAdapter, type GigAdapterContext } from "./types";

export const FREELANCER_HOST = "www.freelancer.com";
const ACTIVE_PATH = "/api/projects/0.1/projects/active/";
/** Projects by id - the freshness read (gigs/freshness.ts). Missing ids are not returned. */
const PROJECTS_PATH = "/api/projects/0.1/projects/";
export const FREELANCER_API_BASE_ENV = "KP_GIGS_FREELANCER_API_BASE";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** An endpoint on the real host, or on the loopback fixture origin the test seam names. */
function freelancerUrl(env: GigAdapterContext["env"], path: string): string {
  const base = env(FREELANCER_API_BASE_ENV)?.trim();
  if (base) {
    try {
      const u = new URL(base);
      if ((u.protocol === "http:" || u.protocol === "https:") && LOOPBACK_HOSTS.has(u.hostname)) return `${u.origin}${path}`;
    } catch {
      // not a URL: ignored, the real host is used
    }
  }
  return `https://${FREELANCER_HOST}${path}`;
}

/** The list endpoint: the real one, or the loopback fixture origin the test seam names. */
export function freelancerActiveUrl(env: GigAdapterContext["env"]): string {
  return freelancerUrl(env, ACTIVE_PATH);
}

// ---------------------------------------------------------------------------
// Freshness: is a project still taking bids? (measured 2026-09-30, keyless 200)
//
//   GET /api/projects/0.1/projects/?projects[]=<id>&projects[]=<id>...&compact=true
//
// answers `result.projects` holding only the projects that still exist publicly; a deleted,
// hidden or private project is simply absent. Seen states: status `active` + frontend
// `open` (open); `closed` + sub_status `closed_awarded` (awarded); `frozen` + `frozen_timeout`
// (frozen - the bid period ran out with no award). `bid_stats.bid_count` is the live count.
// ---------------------------------------------------------------------------

/** Ids per freshness request: the query string stays well inside URL limits. */
export const FREELANCER_FRESHNESS_BATCH = 50;

/** A Freelancer project id from a gig's external key (`fl:<id>`), else null. Pure. */
export function freelancerProjectIdOf(externalKey: string): number | null {
  const m = /^fl:(\d{1,12})$/.exec(externalKey);
  return m ? Number(m[1]) : null;
}

type FlProjectState = {
  id?: unknown;
  status?: unknown;
  sub_status?: unknown;
  frontend_project_status?: unknown;
  deleted?: unknown;
  bid_stats?: { bid_count?: unknown } | null;
};

/** One returned project's state, classified. Pure. */
export function freelancerProjectState(p: FlProjectState, checkedAt: string): GigSourceState {
  const status = str(p.status)?.toLowerCase() ?? null;
  const sub = str(p.sub_status)?.toLowerCase() ?? null;
  const front = str(p.frontend_project_status)?.toLowerCase() ?? null;
  const bidCount = num(p.bid_stats?.bid_count);
  const detail = sub ?? status;
  const state: GigSourceStateName =
    p.deleted === true
      ? "gone"
      : status === "active" && (front === null || front === "open")
        ? "open"
        : sub === "closed_awarded" || front === "work_in_progress" || front === "complete"
          ? "awarded"
          : status === "frozen"
            ? "frozen"
            : status === "active"
              ? "open"
              : "closed";
  return { state, detail, bidCount, checkedAt };
}

/** Read the state of up to FREELANCER_FRESHNESS_BATCH projects in ONE request. An id the
 *  API did not return is `gone`. Answers null when the request did not produce a readable
 *  answer (a halt the caller maps, or a changed shape) - nothing is claimed about any id. */
export async function readFreelancerProjectStates(
  ids: readonly number[],
  io: { fetch: GigAdapterContext["fetch"]; env: GigAdapterContext["env"]; sourceId: string; now: () => string }
): Promise<{ ok: true; states: Map<number, GigSourceState> } | { ok: false; reason: string }> {
  const batch = [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, FREELANCER_FRESHNESS_BATCH);
  if (batch.length === 0) return { ok: true, states: new Map() };
  const params = new URLSearchParams({ compact: "true" });
  for (const id of batch) params.append("projects[]", String(id));
  const outcome = await io.fetch(`${freelancerUrl(io.env, PROJECTS_PATH)}?${params.toString()}`, { sourceId: io.sourceId, accept: "application/json" });
  if (outcome.kind !== "ok") return { ok: false, reason: outcome.kind };
  const parsed = parseJsonBody(outcome.body) as { status?: unknown; result?: { projects?: unknown } } | null;
  const raw = parsed && typeof parsed === "object" && parsed.status === "success" ? parsed.result?.projects : undefined;
  // The API answers a list here; a keyed object is accepted too rather than read as "all gone".
  const projects = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw) : null;
  if (!projects) return { ok: false, reason: "shape_changed" };
  const checkedAt = io.now();
  const states = new Map<number, GigSourceState>();
  for (const p of projects as FlProjectState[]) {
    const id = p && typeof p === "object" ? num(p.id) : null;
    if (id !== null && batch.includes(id)) states.set(id, freelancerProjectState(p, checkedAt));
  }
  for (const id of batch) {
    if (!states.has(id)) states.set(id, { state: "gone", detail: null, bidCount: null, checkedAt });
  }
  return { ok: true, states };
}
const PAGE_SIZE = 50;
const MAX_PAGES = 2;
/** Skill ids one source may filter on. The API takes a repeated `jobs[]`; 50 keeps the query
 *  string short while covering any real skills list (the shared default of 10 cut 13 to 10). */
export const FREELANCER_MAX_JOBS = 50;

type FlProject = {
  id?: unknown;
  title?: unknown;
  seo_url?: unknown;
  description?: unknown;
  preview_description?: unknown;
  type?: unknown;
  bidperiod?: unknown;
  budget?: { minimum?: unknown; maximum?: unknown } | null;
  currency?: { code?: unknown; sign?: unknown } | null;
  jobs?: unknown;
  time_submitted?: unknown;
  submitdate?: unknown;
};

function fmt(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString("en-US") : n.toFixed(2);
}

export function freelancerReward(p: FlProject): GigReward | null {
  const min = num(p.budget?.minimum);
  const max = num(p.budget?.maximum);
  if (min === null && max === null) return null;
  const code = str(p.currency?.code)?.toUpperCase() ?? null;
  const sign = str(p.currency?.sign) ?? "";
  const range = min !== null && max !== null && max !== min ? `${sign}${fmt(min)}-${sign}${fmt(max)}` : `${sign}${fmt((min ?? max) as number)}`;
  const hourly = p.type === "hourly" ? "/hr" : "";
  return { amount: min ?? max, currency: code, text: `${range}${hourly}${code ? ` ${code}` : ""}` };
}

export function freelancerProjectToRaw(p: FlProject): RawGig | null {
  const id = num(p.id);
  const title = str(p.title);
  if (id === null || !title) return null;
  const seo = str(p.seo_url);
  const submitted = num(p.time_submitted) ?? num(p.submitdate);
  const bidDays = num(p.bidperiod);
  const jobs = Array.isArray(p.jobs) ? (p.jobs as { name?: unknown }[]).map((j) => str(j?.name)).filter((s): s is string => s !== null) : [];
  return {
    externalKey: `fl:${id}`,
    // seo_url is "<category>/<slug>"; only a path-safe value is interpolated.
    url: seo && /^[\w\-/]{1,300}$/.test(seo) ? `https://${FREELANCER_HOST}/projects/${seo}` : `https://${FREELANCER_HOST}/projects/${id}`,
    title,
    org: null,
    reward: freelancerReward(p),
    // The bid window closes `bidperiod` days after submission - the deadline that matters for a proposal.
    deadlineAt: submitted !== null && bidDays !== null && bidDays > 0 ? new Date((submitted + bidDays * 86_400) * 1000).toISOString() : null,
    postedAt: submitted !== null ? isoOrNull(submitted) : null,
    bodyText: clipBody(str(p.description) ?? str(p.preview_description) ?? ""),
    bodyHtml: null,
    tags: jobs,
  };
}

export const freelancerAdapter: GigAdapter = {
  name: "freelancer_api",
  arena: "freelance",
  async *discover(ctx) {
    const limit = Math.max(1, Math.min(PAGE_SIZE, ctx.limits.maxItems));
    const query = str(ctx.source.config.query)?.slice(0, 120) ?? null;
    const listed = cfgListAll(ctx.source.config, "jobs");
    const jobs = cfgList(ctx.source.config, "jobs", FREELANCER_MAX_JOBS).filter((j) => /^\d{1,6}$/.test(j));
    // Never a silent narrowing: a dropped or unreadable skill id changes what the search returns.
    if (listed.length > FREELANCER_MAX_JOBS) {
      ctx.log({ level: "warn", code: "config_truncated", detail: `jobs: ${listed.length} listed, the first ${FREELANCER_MAX_JOBS} used` });
    }
    const invalid = listed.slice(0, FREELANCER_MAX_JOBS).filter((j) => !/^\d{1,6}$/.test(j));
    if (invalid.length > 0) ctx.log({ level: "warn", code: "config_invalid", detail: `jobs: not a skill id: ${invalid.slice(0, 5).join(", ")}` });
    const activeUrl = freelancerActiveUrl(ctx.env);
    let yielded = 0;
    for (let page = 0; page < MAX_PAGES && yielded < ctx.limits.maxItems; page++) {
      const params = new URLSearchParams({
        full_description: "true",
        job_details: "true",
        compact: "true",
        limit: String(limit),
        offset: String(page * limit),
      });
      if (query) params.set("query", query);
      for (const j of jobs) params.append("jobs[]", j);
      const res = mustOk(await ctx.fetch(`${activeUrl}?${params.toString()}`, { sourceId: ctx.source.id, accept: "application/json" }));
      const parsed = parseJsonBody(res.body) as { status?: unknown; result?: { projects?: unknown } } | null;
      if (!parsed || typeof parsed !== "object" || parsed.status !== "success" || !Array.isArray(parsed.result?.projects)) {
        throw new AdapterCollapsed("shape_changed", "Freelancer projects/active answered without result.projects");
      }
      const projects = parsed.result.projects as FlProject[];
      for (const p of projects) {
        if (yielded >= ctx.limits.maxItems) break;
        if (!p || typeof p !== "object") continue;
        const raw = freelancerProjectToRaw(p);
        if (!raw) continue;
        yielded++;
        yield raw;
      }
      if (projects.length < limit) break;
    }
  },
};
