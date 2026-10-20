// hackerone: security programs that accept submissions and pay bounties.
//
// With a key (HACKERONE_API_USERNAME + HACKERONE_API_TOKEN, the Hacker API's basic auth):
//   GET https://api.hackerone.com/v1/hackers/programs?page[size]=100      (JSON:API list)
//   GET https://api.hackerone.com/v1/hackers/programs/{handle}            (policy + scopes,
//                                                                          within the detail budget)
//
// Without a key: the public directory needs auth, so program DISCOVERY falls back to the
// keyless, terms-clean public dataset arkadiyt/bounty-targets-data (a daily snapshot of
// HackerOne's public program directory, ~18 MB) - STREAMED item by item, never buffered.
// The run log says so (`hackerone_public_dataset`), and the dataset carries no bounty
// table, so every such listing has `reward: null`. Setting `publicFallback: false` in
// the source config turns the fallback off, and the keyless run is then `skipped:
// no_key` like the other keyed adapters.
//
// Only programs that are OPEN for submissions and OFFER bounties are listed (a VDP pays
// nothing; `includeVdp: true` in config lists them too). A program's reward table is
// per-severity and lives in its policy, so `reward` is null unless the policy states a
// single amount beside a reward word.

import type { RawGig } from "../types";
import { readJsonArrayStream } from "../../jobseeker/adapters/jsonArrayStream";
import { basicAuth, clipBody, detailOk, envKey, isoOrNull, mustOk, parseJsonBody, parseMoney, str } from "./shared";
import { AdapterCollapsed, GigAdapterSkipped, type GigAdapter, type GigAdapterContext } from "./types";

export const HACKERONE_API_HOST = "api.hackerone.com";
const PROGRAMS_URL = `https://${HACKERONE_API_HOST}/v1/hackers/programs`;
export const HACKERONE_PUBLIC_DATASET_URL =
  "https://raw.githubusercontent.com/arkadiyt/bounty-targets-data/main/data/hackerone_data.json";
const MAX_PAGES = 3;

type H1ProgramAttributes = {
  handle?: unknown;
  name?: unknown;
  currency?: unknown;
  submission_state?: unknown;
  offers_bounties?: unknown;
  started_accepting_at?: unknown;
  policy?: unknown;
};
type H1Program = { id?: unknown; type?: unknown; attributes?: H1ProgramAttributes };
type H1Scope = { attributes?: { asset_type?: unknown; asset_identifier?: unknown; eligible_for_bounty?: unknown } };

type DatasetTarget = { asset_identifier?: unknown; asset_type?: unknown; eligible_for_bounty?: unknown; instruction?: unknown };
type DatasetProgram = {
  handle?: unknown;
  name?: unknown;
  url?: unknown;
  offers_bounties?: unknown;
  submission_state?: unknown;
  targets?: { in_scope?: unknown };
};

const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{0,80}$/i;

function wanted(offersBounties: unknown, submissionState: unknown, includeVdp: boolean): boolean {
  return submissionState === "open" && (includeVdp || offersBounties === true);
}

function uniq(list: (string | null)[]): string[] {
  return [...new Set(list.filter((s): s is string => typeof s === "string" && s.length > 0))];
}

/** One Hacker API program (list row, optionally completed by its detail) -> RawGig. */
export function hackeroneProgramToRaw(p: H1Program, detail: { policy: string | null; scopes: H1Scope[] } | null): RawGig | null {
  const a = p.attributes ?? {};
  const handle = str(a.handle);
  if (!handle || !HANDLE_RE.test(handle)) return null;
  const name = str(a.name) ?? handle;
  const policy = detail?.policy ?? str(a.policy);
  const scopes = detail?.scopes ?? [];
  const scopeLines = scopes
    .map((s) => str(s.attributes?.asset_identifier))
    .filter((s): s is string => s !== null)
    .slice(0, 40);
  const money = parseMoney(policy, { requireRewardWord: true });
  const currency = str(a.currency)?.toUpperCase() ?? null;
  return {
    externalKey: `h1:${handle}`,
    url: `https://hackerone.com/${handle}`,
    title: name,
    org: name,
    reward: money ? { ...money, currency: money.currency ?? currency } : null,
    deadlineAt: null,
    postedAt: isoOrNull(a.started_accepting_at),
    bodyText: clipBody([policy, scopeLines.length ? `In scope:\n${scopeLines.join("\n")}` : null].filter(Boolean).join("\n\n")),
    bodyHtml: null,
    tags: uniq(scopes.map((s) => str(s.attributes?.asset_type))),
  };
}

/** One row of the public dataset -> RawGig (reward always null: no bounty table there). */
export function hackeroneDatasetToRaw(p: DatasetProgram): RawGig | null {
  const handle = str(p.handle);
  if (!handle || !HANDLE_RE.test(handle)) return null;
  const name = str(p.name) ?? handle;
  const targets = Array.isArray(p.targets?.in_scope) ? (p.targets.in_scope as DatasetTarget[]) : [];
  const lines = targets
    .slice(0, 40)
    .map((t) => {
      const id = str(t.asset_identifier);
      if (!id) return null;
      const note = str(t.instruction);
      return `${id}${t.eligible_for_bounty === true ? " (bounty-eligible)" : ""}${note ? ` - ${note.replace(/\s+/g, " ").slice(0, 300)}` : ""}`;
    })
    .filter((s): s is string => s !== null);
  return {
    externalKey: `h1:${handle}`,
    url: `https://hackerone.com/${handle}`,
    title: name,
    org: name,
    reward: null,
    deadlineAt: null,
    postedAt: null,
    bodyText: clipBody(lines.length ? `In scope:\n${lines.join("\n")}` : ""),
    bodyHtml: null,
    tags: uniq(targets.map((t) => str(t.asset_type))),
  };
}

async function programDetail(handle: string, ctx: GigAdapterContext, auth: string): Promise<{ policy: string | null; scopes: H1Scope[] } | null> {
  const url = `${PROGRAMS_URL}/${encodeURIComponent(handle)}`;
  const res = detailOk(await ctx.fetch(url, { sourceId: ctx.source.id, accept: "application/json", authorization: auth }), ctx, url);
  if (!res) return null;
  const parsed = parseJsonBody(res.body) as {
    attributes?: { policy?: unknown };
    relationships?: { structured_scopes?: { data?: unknown } };
  } | null;
  if (!parsed || typeof parsed !== "object") {
    ctx.log({ level: "warn", code: "program_detail_shape", detail: handle });
    return null;
  }
  const scopes = parsed.relationships?.structured_scopes?.data;
  return { policy: str(parsed.attributes?.policy), scopes: Array.isArray(scopes) ? (scopes as H1Scope[]) : [] };
}

async function* fromHackerApi(ctx: GigAdapterContext, auth: string, includeVdp: boolean): AsyncGenerator<RawGig> {
  let url: string | null = `${PROGRAMS_URL}?page%5Bsize%5D=100`;
  let yielded = 0;
  let detailFetches = 0;
  for (let page = 0; page < MAX_PAGES && url && yielded < ctx.limits.maxItems; page++) {
    const res = mustOk(await ctx.fetch(url, { sourceId: ctx.source.id, accept: "application/json", authorization: auth }));
    const parsed = parseJsonBody(res.body) as { data?: unknown; links?: { next?: unknown } } | null;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.data)) {
      throw new AdapterCollapsed("shape_changed", "HackerOne programs answered without a data array");
    }
    for (const p of parsed.data as H1Program[]) {
      if (yielded >= ctx.limits.maxItems) break;
      if (!p || typeof p !== "object" || !p.attributes) continue;
      if (!wanted(p.attributes.offers_bounties, p.attributes.submission_state, includeVdp)) continue;
      const handle = str(p.attributes.handle);
      let detail: { policy: string | null; scopes: H1Scope[] } | null = null;
      if (handle && HANDLE_RE.test(handle) && detailFetches < ctx.limits.maxDetailFetches) {
        detailFetches++;
        detail = await programDetail(handle, ctx, auth);
      }
      const raw = hackeroneProgramToRaw(p, detail);
      if (!raw) continue;
      yielded++;
      yield raw;
    }
    const next = str(parsed.links?.next);
    // Pagination links stay on the API host; anything else is not followed.
    url = next && next.startsWith(`https://${HACKERONE_API_HOST}/`) ? next : null;
  }
}

async function* fromPublicDataset(ctx: GigAdapterContext, includeVdp: boolean): AsyncGenerator<RawGig> {
  ctx.log({ level: "info", code: "hackerone_public_dataset", detail: "no HackerOne token: program discovery from arkadiyt/bounty-targets-data; reward unknown" });
  const res = mustOk(await ctx.fetch(HACKERONE_PUBLIC_DATASET_URL, { sourceId: ctx.source.id, accept: "application/json", stream: true }));
  if (!res.stream) throw new AdapterCollapsed("shape_changed", "the HackerOne public dataset returned no body stream");
  let yielded = 0;
  let seen = 0;
  // The file is one JSON array; an element over 2 MB is a malformed row, not a program.
  for await (const item of readJsonArrayStream(res.stream, { maxItemChars: 2 * 1024 * 1024 })) {
    seen++;
    if (!item || typeof item !== "object") continue;
    const p = item as DatasetProgram;
    if (!wanted(p.offers_bounties, p.submission_state, includeVdp)) continue;
    const raw = hackeroneDatasetToRaw(p);
    if (!raw) continue;
    yielded++;
    yield raw;
    if (yielded >= ctx.limits.maxItems) return;
  }
  if (seen === 0) throw new AdapterCollapsed("shape_changed", "the HackerOne public dataset held no program array");
}

export const hackeroneAdapter: GigAdapter = {
  name: "hackerone",
  arena: "security",
  async *discover(ctx) {
    const includeVdp = ctx.source.config.includeVdp === true;
    const user = envKey(ctx, "HACKERONE_API_USERNAME");
    const token = envKey(ctx, "HACKERONE_API_TOKEN");
    if (user && token) {
      yield* fromHackerApi(ctx, basicAuth(user, token), includeVdp);
      return;
    }
    if (ctx.source.config.publicFallback === false) {
      throw new GigAdapterSkipped("no_key", "HACKERONE_API_USERNAME and HACKERONE_API_TOKEN are not both set");
    }
    yield* fromPublicDataset(ctx, includeVdp);
  },
};
