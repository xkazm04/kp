// Greenhouse Job Board API (public, no key): one GET returns every open job with
// its content when `content=true`. config: { token } — the board token in the
// company's careers URL (boards.greenhouse.io/<token>).

import type { RawPosting } from "../../types";
import { bodyFromHtml, cfg, isoOrNull, mustOk, parseJsonBody, rawPosting, safeSlug, str, workModeFromText } from "../shared";
import { AdapterCollapsed, FetchHalt, type PostingRef, type SourceAdapter } from "../types";

export const GREENHOUSE_HOST = "boards-api.greenhouse.io";
export const greenhouseUrl = (token: string) => `https://${GREENHOUSE_HOST}/v1/boards/${token}/jobs?content=true`;

export function greenhouseJobToRaw(job: Record<string, unknown>): RawPosting | null {
  const id = job.id !== undefined ? String(job.id) : null;
  const title = str(job.title);
  const url = str(job.absolute_url);
  if (!id || !title || !url) return null;
  const location = job.location as Record<string, unknown> | undefined;
  const bodyText = bodyFromHtml(str(job.content));
  const loc = str(location?.name);
  return rawPosting({
    externalKey: id,
    url,
    title,
    company: null,
    location: loc,
    workMode: workModeFromText(`${loc ?? ""} ${title} ${bodyText.slice(0, 4000)}`),
    postedAt: isoOrNull(job.first_published) ?? isoOrNull(job.updated_at),
    bodyText,
  });
}

export const greenhouseAdapter: SourceAdapter = {
  name: "ats_greenhouse",
  detailFetches: false,
  async *discover(ctx) {
    const token = safeSlug(cfg(ctx.source, "token"));
    if (!token) throw new FetchHalt({ kind: "outage", detail: "config_missing_token" });
    const out = mustOk(await ctx.fetch(greenhouseUrl(token), { sourceId: ctx.source.id, accept: "application/json" }));
    const payload = parseJsonBody(out.body) as { jobs?: unknown } | null;
    if (!payload || !Array.isArray(payload.jobs)) throw new AdapterCollapsed("shape_changed", "Greenhouse response has no jobs array");
    let n = 0;
    for (const job of payload.jobs as Record<string, unknown>[]) {
      const raw = greenhouseJobToRaw(job);
      if (!raw) continue;
      raw.company = cfg(ctx.source, "company") ?? token;
      yield { externalKey: raw.externalKey, url: raw.url, hint: raw } satisfies PostingRef;
      if (++n >= ctx.limits.maxRefs) return;
    }
  },
  async detail(ref) {
    return ref.hint?.title ? rawPosting({ ...ref.hint, externalKey: ref.externalKey, url: ref.url, title: ref.hint.title }) : null;
  },
};
