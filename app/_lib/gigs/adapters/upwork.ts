// upwork_api: Upwork marketplace job postings, via the official GraphQL API.
//
//   POST https://api.upwork.com/graphql
//   Authorization: Bearer UPWORK_API_TOKEN          (an OAuth2 access token the operator
//                                                    minted for their own Upwork API key)
//   query marketplaceJobPostingsSearch(marketPlaceJobFilter: { searchExpression_eq,
//         pagination_eq: { first } }, searchType: USER_JOBS_SEARCH, sortAttributes: [{ field: RECENCY }])
//
// Tier B: it runs only after the operator acknowledged the API terms (the store keeps a
// tier-B source disabled until then). No token -> declined `no_key` before any network,
// and the scan pauses the source until the operator sets it and resumes.
//
// KNOWN (checked 2026-09-24): api.upwork.com/robots.txt is `User-agent: * / Disallow: /`,
// and politeFetch honours robots.txt for every host, so a keyed run currently ends
// `failed: robots_disallowed` rather than fetching. That is the polite door working as
// written; whether an authenticated API call should be exempt from a crawler policy is an
// owner decision for politeFetch, not something this adapter works around.
//
// Reward: a fixed-price posting's `amount`, or the hourly band `hourlyBudgetMin/Max`
// (text says "/hr"). Neither -> `reward: null`. A GraphQL `errors` answer with no data is
// a collapse (the source pauses and the owner sees the provider's words in the log).
//
// Config (never a secret): `query` (the search expression).

import type { GigReward, RawGig } from "../types";
import { clipBody, envKey, isoOrNull, mustOk, num, parseJsonBody, str } from "./shared";
import { AdapterCollapsed, GigAdapterSkipped, type GigAdapter } from "./types";

export const UPWORK_API_HOST = "api.upwork.com";
const GRAPHQL_URL = `https://${UPWORK_API_HOST}/graphql`;

export const UPWORK_SEARCH_QUERY = `query GigSearch($filter: MarketplaceJobPostingsSearchFilter) {
  marketplaceJobPostingsSearch(marketPlaceJobFilter: $filter, searchType: USER_JOBS_SEARCH, sortAttributes: [{ field: RECENCY }]) {
    totalCount
    edges {
      node {
        id
        ciphertext
        title
        description
        category
        subcategory
        experienceLevel
        duration
        createdDateTime
        publishedDateTime
        amount { rawValue currency displayValue }
        hourlyBudgetMin { rawValue currency displayValue }
        hourlyBudgetMax { rawValue currency displayValue }
        skills { name prettyName }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

type Money = { rawValue?: unknown; currency?: unknown; displayValue?: unknown } | null | undefined;
type UpworkNode = {
  id?: unknown;
  ciphertext?: unknown;
  title?: unknown;
  description?: unknown;
  category?: unknown;
  subcategory?: unknown;
  createdDateTime?: unknown;
  publishedDateTime?: unknown;
  amount?: Money;
  hourlyBudgetMin?: Money;
  hourlyBudgetMax?: Money;
  skills?: unknown;
};

function moneyValue(m: Money): number | null {
  const v = num(m?.rawValue);
  return v !== null && v > 0 ? v : null;
}

export function upworkReward(n: UpworkNode): GigReward | null {
  const fixed = moneyValue(n.amount);
  if (fixed !== null) {
    const currency = str(n.amount?.currency)?.toUpperCase() ?? null;
    return { amount: fixed, currency, text: str(n.amount?.displayValue) ?? `${fixed}${currency ? ` ${currency}` : ""}` };
  }
  const lo = moneyValue(n.hourlyBudgetMin);
  const hi = moneyValue(n.hourlyBudgetMax);
  if (lo === null && hi === null) return null;
  const currency = str(n.hourlyBudgetMin?.currency ?? n.hourlyBudgetMax?.currency)?.toUpperCase() ?? null;
  const band = lo !== null && hi !== null && hi !== lo ? `${lo}-${hi}` : `${lo ?? hi}`;
  return { amount: lo ?? hi, currency, text: `${band}/hr${currency ? ` ${currency}` : ""}` };
}

export function upworkNodeToRaw(n: UpworkNode): RawGig | null {
  const id = str(n.id);
  const title = str(n.title);
  if (!id || !title) return null;
  const cipher = str(n.ciphertext);
  const skills = Array.isArray(n.skills)
    ? (n.skills as { name?: unknown; prettyName?: unknown }[]).map((s) => str(s?.prettyName) ?? str(s?.name)).filter((s): s is string => s !== null)
    : [];
  return {
    externalKey: `upwork:${id}`,
    url: cipher && /^~?[\w]{6,64}$/.test(cipher) ? `https://www.upwork.com/jobs/${cipher}` : `https://www.upwork.com/jobs/${encodeURIComponent(id)}`,
    title,
    // Upwork does not name the client in search results; the org stays unknown.
    org: null,
    reward: upworkReward(n),
    deadlineAt: null,
    postedAt: isoOrNull(n.publishedDateTime) ?? isoOrNull(n.createdDateTime),
    bodyText: clipBody(str(n.description)),
    bodyHtml: null,
    tags: [str(n.category), str(n.subcategory), ...skills].filter((s): s is string => s !== null),
  };
}

export const upworkAdapter: GigAdapter = {
  name: "upwork_api",
  arena: "freelance",
  async *discover(ctx) {
    const token = envKey(ctx, "UPWORK_API_TOKEN");
    if (!token) throw new GigAdapterSkipped("no_key", "UPWORK_API_TOKEN is not set");
    const filter: Record<string, unknown> = { pagination_eq: { first: Math.max(1, Math.min(50, ctx.limits.maxItems)) } };
    const q = str(ctx.source.config.query)?.slice(0, 200);
    if (q) filter.searchExpression_eq = q;
    const res = mustOk(
      await ctx.fetch(GRAPHQL_URL, {
        sourceId: ctx.source.id,
        method: "POST",
        accept: "application/json",
        contentType: "application/json",
        authorization: `Bearer ${token}`,
        body: JSON.stringify({ query: UPWORK_SEARCH_QUERY, variables: { filter } }),
      })
    );
    const parsed = parseJsonBody(res.body) as {
      data?: { marketplaceJobPostingsSearch?: { edges?: unknown } | null } | null;
      errors?: unknown;
    } | null;
    const edges = parsed?.data?.marketplaceJobPostingsSearch?.edges;
    if (!Array.isArray(edges)) {
      const first = Array.isArray(parsed?.errors) ? str((parsed.errors[0] as { message?: unknown } | undefined)?.message) : null;
      throw new AdapterCollapsed("shape_changed", `Upwork search answered without edges${first ? `: ${first.slice(0, 200)}` : ""}`);
    }
    let yielded = 0;
    for (const e of edges as { node?: UpworkNode }[]) {
      if (yielded >= ctx.limits.maxItems) break;
      const node = e?.node;
      if (!node || typeof node !== "object") continue;
      const raw = upworkNodeToRaw(node);
      if (!raw) continue;
      yielded++;
      yield raw;
    }
  },
};
