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

import type { GigReward, RawGig } from "../types";
import { cfgList, clipBody, isoOrNull, mustOk, num, parseJsonBody, str } from "./shared";
import { AdapterCollapsed, type GigAdapter } from "./types";

export const FREELANCER_HOST = "www.freelancer.com";
const ACTIVE_URL = `https://${FREELANCER_HOST}/api/projects/0.1/projects/active/`;
const PAGE_SIZE = 50;
const MAX_PAGES = 2;

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
    const jobs = cfgList(ctx.source.config, "jobs").filter((j) => /^\d{1,6}$/.test(j));
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
      const res = mustOk(await ctx.fetch(`${ACTIVE_URL}?${params.toString()}`, { sourceId: ctx.source.id, accept: "application/json" }));
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
