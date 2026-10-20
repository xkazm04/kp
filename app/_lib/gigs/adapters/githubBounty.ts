// github_bounty: open issues labelled as bounties, via the GitHub search API.
//
//   GET https://api.github.com/search/issues?q=is:issue state:open label:bounty&sort=created&order=desc&per_page=N
//
// Keyless works (the search API allows unauthenticated calls at a lower rate); a
// GITHUB_TOKEN / GH_TOKEN, when set, rides as a bearer through the polite door. A rate
// limit answers 403/429, which politeFetch classifies `blocked` - the source pauses and
// the operator decides, exactly like any other denial.
//
// Reward: most bounty issues state NO amount in the issue itself (measured 2026-09-24:
// 16 of 16) - it lives in a bot comment (Algora's "💎 $500 bounty") or on a board. So
// the read is labels -> title -> body (only beside a reward word), and when all three
// are silent and the issue has comments, the first bot comment is read while the detail
// budget lasts. Nothing parses -> `reward: null`, never 0.
//
// Config (never a secret): `labels` (default ["bounty"]; several are OR-ed), `query`
// (extra search qualifiers, e.g. "language:rust").

import type { GigReward, RawGig } from "../types";
import { cfgList, clipBody, detailOk, envKey, isoOrNull, mustOk, num, parseJsonBody, parseMoney, str } from "./shared";
import { AdapterCollapsed, type GigAdapter, type GigAdapterContext } from "./types";

export const GITHUB_API_HOST = "api.github.com";
const SEARCH_URL = `https://${GITHUB_API_HOST}/search/issues`;
const PAGE_SIZE = 100;
const MAX_PAGES = 2;
/** Bot logins whose comment states the bounty amount on someone else's issue. */
const BOUNTY_BOTS = ["algora-pbc", "algora-pbc[bot]", "opirebot", "bountysource", "issuehunt"];

type GhLabel = { name?: unknown };
type GhIssue = {
  html_url?: unknown;
  id?: unknown;
  number?: unknown;
  title?: unknown;
  body?: unknown;
  labels?: unknown;
  repository_url?: unknown;
  comments?: unknown;
  comments_url?: unknown;
  created_at?: unknown;
  pull_request?: unknown;
};
type GhComment = { body?: unknown; user?: { login?: unknown; type?: unknown } | null };

/** A label is used verbatim inside a quoted search qualifier: quotes and control
 *  characters are stripped so config cannot break out of it. */
function quoteLabel(label: string): string {
  const clean = label.replace(/["\\\u0000-\u001f]/g, "").trim().slice(0, 50);
  return /[\s,]/.test(clean) ? `"${clean}"` : clean;
}

export function githubSearchQuery(config: Record<string, unknown>): string {
  const labels = cfgList(config, "labels").map(quoteLabel).filter(Boolean);
  const extra = str(config.query)?.replace(/[\u0000-\u001f]/g, " ").slice(0, 200) ?? "";
  const q = `is:issue state:open label:${(labels.length ? labels : ["bounty"]).join(",")}${extra ? ` ${extra}` : ""}`;
  return q;
}

function labelNames(v: unknown): string[] {
  return Array.isArray(v) ? (v as GhLabel[]).map((l) => str(l?.name)).filter((s): s is string => s !== null) : [];
}

function ownerFromRepoUrl(url: string | null): string | null {
  const m = url ? /\/repos\/([^/]+)\/[^/]+$/.exec(url) : null;
  return m ? m[1] : null;
}

function isBountyBot(c: GhComment): boolean {
  const login = str(c.user?.login)?.toLowerCase() ?? "";
  return c.user?.type === "Bot" || login.endsWith("[bot]") || BOUNTY_BOTS.includes(login);
}

/** The reward the issue itself states: labels, then title, then body beside a reward word. */
export function rewardFromIssue(labels: string[], title: string, body: string): GigReward | null {
  for (const label of labels) {
    const r = parseMoney(label);
    if (r) return r;
  }
  return parseMoney(title) ?? parseMoney(body, { requireRewardWord: true });
}

async function rewardFromBotComment(issue: GhIssue, ctx: GigAdapterContext, auth: string | undefined): Promise<GigReward | null> {
  const url = str(issue.comments_url);
  if (!url || !url.startsWith(`https://${GITHUB_API_HOST}/`)) return null;
  const outcome = await ctx.fetch(`${url}?per_page=10`, {
    sourceId: ctx.source.id,
    accept: "application/vnd.github+json",
    authorization: auth,
  });
  const res = detailOk(outcome, ctx, url);
  if (!res) return null;
  const parsed = parseJsonBody(res.body);
  if (!Array.isArray(parsed)) {
    ctx.log({ level: "warn", code: "comments_shape", detail: url });
    return null;
  }
  for (const c of parsed as GhComment[]) {
    if (!c || typeof c !== "object" || !isBountyBot(c)) continue;
    const r = parseMoney(str(c.body), { requireRewardWord: true });
    if (r) return r;
  }
  return null;
}

export const githubBountyAdapter: GigAdapter = {
  name: "github_bounty",
  arena: "oss_bounty",
  async *discover(ctx) {
    const token = envKey(ctx, "GITHUB_TOKEN", "GH_TOKEN");
    const auth = token ? `Bearer ${token}` : undefined;
    if (!token) ctx.log({ level: "info", code: "github_keyless", detail: "unauthenticated search (lower rate limit)" });
    const q = githubSearchQuery(ctx.source.config);
    const perPage = Math.max(1, Math.min(PAGE_SIZE, ctx.limits.maxItems));
    let yielded = 0;
    let detailFetches = 0;
    for (let page = 1; page <= MAX_PAGES && yielded < ctx.limits.maxItems; page++) {
      const url = `${SEARCH_URL}?q=${encodeURIComponent(q)}&sort=created&order=desc&per_page=${perPage}&page=${page}`;
      const res = mustOk(await ctx.fetch(url, { sourceId: ctx.source.id, accept: "application/vnd.github+json", authorization: auth }));
      const parsed = parseJsonBody(res.body) as { items?: unknown; total_count?: unknown } | null;
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.items)) {
        throw new AdapterCollapsed("shape_changed", "GitHub search answered without an items array");
      }
      const items = parsed.items as GhIssue[];
      for (const issue of items) {
        if (yielded >= ctx.limits.maxItems) break;
        if (!issue || typeof issue !== "object" || issue.pull_request) continue;
        const htmlUrl = str(issue.html_url);
        const title = str(issue.title);
        const id = num(issue.id);
        if (!htmlUrl || !title || id === null) continue;
        const labels = labelNames(issue.labels);
        const body = clipBody(str(issue.body));
        let reward = rewardFromIssue(labels, title, body);
        if (!reward && (num(issue.comments) ?? 0) > 0 && detailFetches < ctx.limits.maxDetailFetches) {
          detailFetches++;
          reward = await rewardFromBotComment(issue, ctx, auth);
        }
        const raw: RawGig = {
          externalKey: `gh:${id}`,
          url: htmlUrl,
          title,
          org: ownerFromRepoUrl(str(issue.repository_url)),
          reward,
          deadlineAt: null,
          postedAt: isoOrNull(issue.created_at),
          bodyText: body,
          bodyHtml: null,
          tags: labels,
        };
        yielded++;
        yield raw;
      }
      if (items.length < perPage) break;
    }
  },
};
