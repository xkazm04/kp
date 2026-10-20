// kaggle: open Kaggle competitions, via the official public API the kaggle CLI uses.
//
//   GET https://www.kaggle.com/api/v1/competitions/list?page=1&sortBy=latestDeadline[&category=..][&search=..]
//   Authorization: Basic base64(KAGGLE_USERNAME:KAGGLE_KEY)
//
// The endpoint answers 401 without a key (measured 2026-09-24), so no key is the
// keyless path by design: the adapter declines with `no_key` before any network and
// the scan pauses the source until the operator sets the key and resumes it.
//
// Reward: the API states it as a string - "$100,000", "Knowledge", "Kudos", "Swag".
// A money string parses to an amount; a non-money prize keeps its words as `text`
// with `amount: null` (stated, but not money - never 0).
//
// The response has been a bare array (CLI <= 1.6) and `{ competitions: [...] }` (the
// kagglesdk era); both are read, anything else is a collapse.
//
// Config (never a secret): `category` (featured, research, playground, ...), `search`.

import type { RawGig } from "../types";
import { basicAuth, clipBody, envKey, isoOrNull, mustOk, parseJsonBody, parseMoney, str } from "./shared";
import { AdapterCollapsed, GigAdapterSkipped, type GigAdapter } from "./types";

export const KAGGLE_HOST = "www.kaggle.com";
const LIST_URL = `https://${KAGGLE_HOST}/api/v1/competitions/list`;
const MAX_PAGES = 3;
const SAFE_PARAM = /^[\w .-]{1,60}$/;

type KaggleCompetition = {
  id?: unknown;
  ref?: unknown;
  url?: unknown;
  title?: unknown;
  description?: unknown;
  organizationName?: unknown;
  category?: unknown;
  reward?: unknown;
  tags?: unknown;
  deadline?: unknown;
  enabledDate?: unknown;
  evaluationMetric?: unknown;
};

function competitionsOf(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { competitions?: unknown }).competitions)) {
    return (parsed as { competitions: unknown[] }).competitions;
  }
  return null;
}

/** `ref` is a slug ("titanic") in the old API and a full URL in the new one. */
function slugOf(c: KaggleCompetition): string | null {
  const ref = str(c.ref) ?? str(c.url);
  if (!ref) return null;
  const m = /\/c(?:ompetitions)?\/([^/?#]+)/.exec(ref);
  const slug = m ? m[1] : ref;
  return /^[a-z0-9][a-z0-9-]{0,120}$/i.test(slug) ? slug : null;
}

function tagNames(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((t) => (typeof t === "string" ? t : str((t as { name?: unknown; ref?: unknown })?.name) ?? str((t as { ref?: unknown })?.ref)))
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0);
}

export function kaggleCompetitionToRaw(c: KaggleCompetition): RawGig | null {
  const slug = slugOf(c);
  const title = str(c.title);
  if (!slug || !title) return null;
  const rewardText = str(c.reward);
  const money = parseMoney(rewardText);
  const category = str(c.category);
  const metric = str(c.evaluationMetric);
  const body = [str(c.description), metric ? `Evaluation metric: ${metric}` : null, category ? `Category: ${category}` : null]
    .filter(Boolean)
    .join("\n");
  return {
    externalKey: `kaggle:${slug}`,
    url: `https://${KAGGLE_HOST}/competitions/${slug}`,
    title,
    org: str(c.organizationName),
    reward: rewardText ? (money ? { ...money, text: rewardText } : { amount: null, currency: null, text: rewardText }) : null,
    deadlineAt: isoOrNull(c.deadline),
    postedAt: isoOrNull(c.enabledDate),
    bodyText: clipBody(body),
    bodyHtml: null,
    tags: [...(category ? [category] : []), ...tagNames(c.tags)],
  };
}

export const kaggleAdapter: GigAdapter = {
  name: "kaggle",
  arena: "competition",
  async *discover(ctx) {
    const user = envKey(ctx, "KAGGLE_USERNAME");
    const key = envKey(ctx, "KAGGLE_KEY");
    if (!user || !key) throw new GigAdapterSkipped("no_key", "KAGGLE_USERNAME and KAGGLE_KEY are not both set");
    const auth = basicAuth(user, key);
    const params = new URLSearchParams({ sortBy: "latestDeadline" });
    for (const k of ["category", "search"] as const) {
      const v = str(ctx.source.config[k]);
      if (v && SAFE_PARAM.test(v)) params.set(k, v);
    }
    let yielded = 0;
    for (let page = 1; page <= MAX_PAGES && yielded < ctx.limits.maxItems; page++) {
      params.set("page", String(page));
      const res = mustOk(await ctx.fetch(`${LIST_URL}?${params.toString()}`, { sourceId: ctx.source.id, accept: "application/json", authorization: auth }));
      const list = competitionsOf(parseJsonBody(res.body));
      if (!list) throw new AdapterCollapsed("shape_changed", "Kaggle competitions/list answered without a competitions array");
      if (list.length === 0) break;
      for (const item of list) {
        if (yielded >= ctx.limits.maxItems) break;
        if (!item || typeof item !== "object") continue;
        const raw = kaggleCompetitionToRaw(item as KaggleCompetition);
        if (!raw) continue;
        yielded++;
        yield raw;
      }
    }
  },
};
