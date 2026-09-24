// Gig research: read the pages a listing links to, then write ONE readable brief.
//
// Listings often carry the real brief behind a link - the issue a bounty points at, the
// spec, the repository, the competition's data page. Research reads at most
// GIG_RESEARCH_MAX_LINKS of them and stores a GigBrief (types.ts): a category and a
// retitle, a difficulty with its reason, an effort range, the expected challenges, the
// Markdown the gig page renders, its sections, and a line per link saying what happened
// to it. docs/features/gigs/README.md "Research" is the operator-facing account.
//
// The rules, in the order a link meets them:
//   1. EXTRACTED from the listing text and the listing HTML's hrefs; the listing's own
//      URL, fragment-only links, images/binaries, credentials-in-URL, social/chat hosts
//      and link shorteners (a shortener hides where it goes) are dropped; the rest are
//      ranked (same repo/org, issue or PR, docs/spec) and capped.
//   2. EGRESS-VETTED by kp's one SSRF guard (ats-egress-guard.ts: string rules + every
//      resolved address public) BEFORE any byte is requested; refused = `blocked`.
//      Under KP_OFFLINE nothing is even resolved: every link is `skipped: offline`.
//   3. FETCHED only through the job-seeker politeFetch door (robots.txt honoured,
//      per-host spacing, a denial is `blocked`), or - for a GitHub issue, PR or repo -
//      through the one GitHub reader (repo-snapshot.ts githubRead). HTML becomes text
//      through the same dependency-free htmlToText every job-seeker adapter uses
//      (job-posting-fetch.ts; ADR 0009 keeps linkedom for the rules engine alone).
//      Each page is capped at GIG_RESEARCH_PAGE_CHARS.
//   4. UNTRUSTED: every fetched page goes through the same deterministic honeypot scan
//      as the listing (suspect.ts). A hit adds its reasons to the gig and moves a `new`
//      or `qualified` gig to `suspect` (transitionGig); the brief is still written and
//      its "Sources read" line names the link that carried it. A suspect gig's links are
//      listed but never followed, and a suspect gig never reaches the model.
//   5. THE MODEL (pipeline/jobfit/gig_brief_cli.py, use case `gig_brief`) receives the
//      listing and the pages ONLY as data inside a nonce fence and answers JSON; kp then
//      writes the Markdown itself from that JSON with a fixed shape (assembleGigBriefMarkdown),
//      inserting every model string as escaped plain text - the model never writes the
//      structure. Headings become `sections` in the same function, ids from ONE assigner
//      (registry: anchor-id-single-assigner, server-parsed-once-reused).
//
// KEYLESS IS A DECISION, NOT A FAULT (jobseeker/deepdive.ts's rule): there is no TS-side
// "is a provider configured" oracle, so the first spawn doubles as the probe. A
// `no_provider` answer switches the rest of a batch to the deterministic brief with no
// further spawn - one cheap spawn per scan keyless, never eight. The deterministic brief
// IS stored (the operator needs the link list); upgrading it is the on-demand
// `POST /api/gigs/[id]/research`, never a loop.
//
// Everything with an effect is injected (GigResearchDeps) so research.test.ts runs over
// fake fetch, fake DNS, fake GitHub and a fake CLI with no network, no DB and no key.

import { assertPublicHttpsEndpointResolved, type HostLookup } from "../ats-egress-guard";
import { getGig, listGigsNeedingBrief, mergeGigSuspectReasons, setGigBrief, transitionGig } from "../db/gigs";
import { htmlTitle, htmlToText } from "../job-posting-fetch";
import { politeFetch, type PoliteFetch } from "../jobseeker/fetch/politeFetch";
import { runPythonCli, type CliRunner } from "../jobseeker/python-cli";
import { isOffline } from "../offline";
import { githubRead, type GithubReadOutcome } from "../repo-snapshot";
import { GIG_RESEARCH_MAX_PER_SCAN, type GigResearchBatchSummary } from "./scan";
import { scanGigForHoneypots } from "./suspect";
import {
  isGigDifficulty,
  isGigSuspectReason,
  type Gig,
  type GigArena,
  type GigBrief,
  type GigBriefLink,
  type GigBriefSection,
  type GigDifficulty,
  type GigSuspectReason,
} from "./types";

export { GIG_RESEARCH_MAX_PER_SCAN };

/** Links read per gig at most. */
export const GIG_RESEARCH_MAX_LINKS = 3;
/** Characters kept per page (and of the listing body handed to the model). */
export const GIG_RESEARCH_PAGE_CHARS = 20_000;
/** One gig's research, page reads and model call together (the on-demand door's bound). */
export const GIG_RESEARCH_BUDGET_MS = 90_000;
/** The model call is not started with less than this left of the budget. */
const LLM_MIN_REMAINING_MS = 15_000;
/** The spawn's hang backstop; the CLI's own provider timeout (60 s) sits under it. */
const LLM_SPAWN_TIMEOUT_MS = 80_000;
/** Kept in lockstep with gig_brief_cli.py PROMPT_VERSION (research.test.ts reads both). */
export const GIG_BRIEF_PROMPT_VERSION = "gig-brief-v1";
/** The politeness key's seed: every research read shares one jitter lane. */
const RESEARCH_FETCH_SOURCE = "gig-research";
const RESEARCH_ACCEPT = "text/html, application/xhtml+xml;q=0.9, text/plain;q=0.9, text/markdown;q=0.9, application/json;q=0.5, */*;q=0.1";
/** Raw HTML handed to the honeypot scan per page (hidden segments live in the markup). */
const HONEYPOT_HTML_CHARS = 200_000;

// ---------------------------------------------------------------------------
// 1. Links: extraction, filtering, ranking (pure)
// ---------------------------------------------------------------------------

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`()[\]{}|\\^]+/gi;
const HREF = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
const TRAILING_PUNCT = /[.,;:!?'"»)\]}>*_~]+$/;

/** Extensions that are never a readable page: images, media, archives, executables, and
 *  documents htmlToText cannot read (a PDF is bytes, not text). */
const BINARY_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "tif", "tiff", "avif", "heic",
  "mp4", "mov", "avi", "webm", "mkv", "mp3", "wav", "ogg", "flac",
  "zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar",
  "exe", "dmg", "msi", "pkg", "deb", "rpm", "apk", "iso", "bin", "jar", "whl",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods",
  "csv", "parquet", "npz", "h5", "pt", "onnx", "ckpt",
]);

/** Hosts whose pages are not research material: social and chat (and a chat invite is a
 *  honeypot's favourite link), link shorteners (the destination is hidden, and the egress
 *  guard vets only the first hop's name), and image/badge CDNs. Matched on the host and
 *  every parent domain. */
const SKIP_HOSTS = new Set([
  "twitter.com", "x.com", "t.co", "facebook.com", "fb.com", "instagram.com", "linkedin.com", "lnkd.in",
  "discord.gg", "discord.com", "discordapp.com", "t.me", "telegram.me", "wa.me", "whatsapp.com",
  "youtube.com", "youtu.be", "tiktok.com", "reddit.com",
  "bit.ly", "tinyurl.com", "goo.gl", "ow.ly", "buff.ly", "rebrand.ly", "is.gd", "cutt.ly", "shorturl.at",
  "githubusercontent.com", "shields.io", "badge.fury.io", "gravatar.com", "imgur.com", "giphy.com",
]);

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);
/** GitHub paths that are chrome, not content. */
const GITHUB_NOISE = /^\/(?:login|signup|join|settings|notifications|sponsors|marketplace|features|pricing|about|contact|site|security\/advisories\/new|[^/]+\/[^/]+\/(?:assets|labels|milestones|stargazers|network|watchers|subscription))(?:[/?#]|$)|^\/user-attachments\//i;
const ISSUE_OR_PR = /\/(?:issues|pull|pulls|merge_requests)\/\d+(?:[/?#]|$)/i;
const DOCS_HOST = /^(?:docs|doc|developer|developers|dev|api|wiki|spec|specs)\.|\.readthedocs\.io$|\.gitbook\.io$/i;
const DOCS_PATH = /\/(?:docs?|documentation|spec|specs|specification|rfcs?|api|wiki|guide|guides|readme(?:\.md)?|contributing(?:\.md)?|rules|overview|data)(?:[/.?#]|$)/i;

function bareHost(host: string): string {
  return host.toLowerCase().replace(/\.+$/, "").replace(/^www\./, "");
}

function hostIsSkipped(host: string): boolean {
  const h = bareHost(host);
  const parts = h.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    if (SKIP_HOSTS.has(parts.slice(i).join("."))) return true;
  }
  return false;
}

/** The last two labels - enough to call two hosts one org for ranking (not for trust). */
function orgDomain(host: string): string {
  return bareHost(host).split(".").slice(-2).join(".");
}

/** A link's comparison form: fragment dropped, host bare, one trailing slash dropped. */
function comparable(u: URL): string {
  return `${bareHost(u.hostname)}${u.port ? `:${u.port}` : ""}${u.pathname.replace(/\/+$/, "")}${u.search}`.toLowerCase();
}

/** Parse one candidate into a fetchable link, or null. Relative hrefs resolve against the
 *  listing's URL; the fragment is dropped; a URL carrying credentials is refused whole. */
function normalizeLink(raw: string, base: URL | null): URL | null {
  const trimmed = raw.trim().replace(/&amp;/gi, "&");
  if (!trimmed || trimmed.startsWith("#")) return null;
  let url: URL;
  try {
    url = base ? new URL(trimmed, base) : new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (!url.hostname) return null;
  url.hash = "";
  return url;
}

function isBinaryPath(pathname: string): boolean {
  const last = pathname.split("/").pop() ?? "";
  const dot = last.lastIndexOf(".");
  if (dot <= 0) return false;
  return BINARY_EXT.has(last.slice(dot + 1).toLowerCase());
}

/** Higher is read first. Same repository/org, an issue or PR, docs or a spec. */
export function rankGigLink(link: URL, listing: URL | null): number {
  let score = 0;
  const host = bareHost(link.hostname);
  if (listing) {
    const lhost = bareHost(listing.hostname);
    if (host === lhost) {
      score += 2;
      if (GITHUB_HOSTS.has(link.hostname.toLowerCase()) || host === "github.com" || host === "gitlab.com") {
        const a = link.pathname.split("/").filter(Boolean).map((s) => s.toLowerCase());
        const b = listing.pathname.split("/").filter(Boolean).map((s) => s.toLowerCase());
        if (a[0] && a[0] === b[0]) score += 1;
        if (a[0] && a[1] && a[0] === b[0] && a[1] === b[1]) score += 1;
      }
    } else if (orgDomain(host) === orgDomain(lhost)) {
      score += 1;
    }
  }
  if (ISSUE_OR_PR.test(link.pathname)) score += 2;
  if (DOCS_HOST.test(host) || DOCS_PATH.test(link.pathname)) score += 2;
  return score;
}

/** Every http(s) link the listing names - in its text and its HTML's hrefs - filtered and
 *  ranked, at most GIG_RESEARCH_MAX_LINKS. Pure. */
export function extractGigLinks(input: { url: string; bodyText: string; bodyHtml: string | null }): string[] {
  let listing: URL | null = null;
  try {
    listing = new URL(input.url);
  } catch {
    listing = null;
  }
  const candidates: string[] = [];
  for (const m of (input.bodyText ?? "").matchAll(URL_IN_TEXT)) candidates.push(m[0].replace(TRAILING_PUNCT, ""));
  for (const m of (input.bodyHtml ?? "").matchAll(HREF)) candidates.push(m[1] ?? m[2] ?? m[3] ?? "");

  const own = listing ? comparable(listing) : null;
  const seen = new Set<string>();
  const kept: { url: URL; order: number; score: number }[] = [];
  for (const raw of candidates) {
    const url = normalizeLink(raw, listing);
    if (!url) continue;
    const key = comparable(url);
    if (key === own || seen.has(key)) continue;
    seen.add(key);
    if (isBinaryPath(url.pathname)) continue;
    if (hostIsSkipped(url.hostname)) continue;
    if (GITHUB_HOSTS.has(url.hostname.toLowerCase()) && GITHUB_NOISE.test(url.pathname)) continue;
    kept.push({ url, order: kept.length, score: rankGigLink(url, listing) });
  }
  kept.sort((a, b) => b.score - a.score || a.order - b.order);
  return kept.slice(0, GIG_RESEARCH_MAX_LINKS).map((k) => k.url.href);
}

// ---------------------------------------------------------------------------
// 2. Markdown assembly, escaping and sections (pure)
// ---------------------------------------------------------------------------

/** Model or page text as ONE line of plain text the renderer prints literally: whitespace
 *  collapsed (so no string can open a block of its own), every inline control character
 *  app/_components/Markdown.tsx interprets backslash-escaped (`\ * \` < # [ ]`), and a
 *  leading `-` / `N.` escaped so it cannot become a list. */
export function escapeBriefText(s: string): string {
  const flat = String(s ?? "").replace(/\s+/g, " ").trim();
  return flat
    .replace(/[\\*`<#[\]]/g, (c) => `\\${c}`)
    .replace(/^-/, "\\-")
    .replace(/^(\d+)\./, "$1\\.");
}

/** Link text: the renderer's link rule cannot hold a `]` even escaped, so brackets become
 *  parentheses first; the rest is escaped like any other text. */
function linkText(s: string): string {
  const flat = String(s ?? "").replace(/[[\]]/g, (c) => (c === "[" ? "(" : ")")).replace(/\s+/g, " ").trim();
  return escapeBriefText(flat.length > 120 ? `${flat.slice(0, 119)}…` : flat);
}

/** An href the renderer's `(...)` rule reads whole: parentheses and whitespace encoded. */
function linkHref(url: string): string {
  return url.replace(/[()\s]/g, (c) => (c === "(" ? "%28" : c === ")" ? "%29" : "%20"));
}

/** A URL shown as inline code (never a link): a backtick would end the span early. */
function codeUrl(url: string): string {
  return url.replace(/`/g, "%60");
}

/** Heading text -> slug: diacritics folded, lower-case, runs of anything else one `-`.
 *  Empty for an emoji-only, punctuation-only or non-Latin-script heading. */
export function slugifyHeading(text: string): string {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** ONE assigner per document (registry: anchor-id-single-assigner). Duplicates become
 *  `x-2`, `x-3`; a heading that slugifies to nothing gets `section-<n>`, n its 1-based
 *  position among the document's headings - deterministic, and run through the same
 *  de-duplication, so a real "Section 2" heading can never collide with it. Its lifetime
 *  is one document: construct it where the document is processed, never share it. */
export function createSectionIdAssigner(): (text: string) => string {
  const issued = new Set<string>();
  let position = 0;
  return (text: string) => {
    position += 1;
    const base = slugifyHeading(text) || `section-${position}`;
    let id = base;
    for (let n = 2; issued.has(id); n++) id = `${base}-${n}`;
    issued.add(id);
    return id;
  };
}

function plainHeadingText(raw: string): string {
  return raw
    .replace(/\\([\\*`<#.\-[\]])/g, "$1")
    .replace(/\*\*|`/g, "")
    .trim();
}

/** The document's `##`/`###` headings with their ids. EVERY heading (level 1 included)
 *  passes through the one assigner so addresses agree with any renderer that numbers all
 *  headings; only levels 2 and 3 are listed (inclusion is a filter AFTER assignment, never
 *  a second walk). Fenced code is not scanned. */
export function parseGigBriefSections(markdown: string): GigBriefSection[] {
  const assign = createSectionIdAssigner();
  const out: GigBriefSection[] = [];
  let fenced = false;
  for (const line of String(markdown ?? "").split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const m = /^(#{1,3})\s+(.*)$/.exec(t);
    if (!m) continue;
    const text = plainHeadingText(m[2]);
    const id = assign(text);
    const level = m[1].length;
    if (level === 2 || level === 3) out.push({ id, level, text });
  }
  return out;
}

/** What the model answered, after kp's own validation (parseGigBriefResult). */
export type GigBriefModelResult = {
  category: string;
  title: string;
  difficulty: GigDifficulty;
  difficultyReason: string | null;
  effort: { minHours: number; maxHours: number; note: string | null } | null;
  challenges: string[];
  /** 2-4 sentences: what the gig is. */
  summary: string;
  /** Deliverables / acceptance, one per bullet. */
  asks: string[];
};

const DIFFICULTY_LABEL: Readonly<Record<GigDifficulty, string>> = {
  easy: "Easy",
  moderate: "Moderate",
  hard: "Hard",
  very_hard: "Very hard",
  unrated: "Unrated",
};

/** The arena's label in a category ("Security · xss"). English, like the brief's headings. */
export const GIG_ARENA_LABEL: Readonly<Record<GigArena, string>> = {
  security: "Security",
  freelance: "Freelance",
  competition: "Competition",
  oss_bounty: "Open-source bounty",
};

/** The five fixed headings, in order. The model never writes a heading. */
export const GIG_BRIEF_HEADINGS = {
  what: "What the gig is",
  asks: "What it asks for",
  difficulty: "Difficulty and effort",
  challenges: "Expected challenges",
  sources: "Sources read",
} as const;

function formatHours(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

function sentence(s: string): string {
  return escapeBriefText(s).replace(/[.!?]+$/, "");
}

/** One "Sources read" line. A link the egress guard refused is shown as code, never as a
 *  clickable link: a private-network address is not one click away from the operator. */
export function sourceLine(link: GigBriefLink): string {
  let status: string;
  if (link.status === "fetched") {
    const flagged = link.reason?.startsWith("suspect:") ? link.reason.slice("suspect:".length).split(",").filter(Boolean) : [];
    status = flagged.length > 0 ? `fetched, flagged as a honeypot (${flagged.map(escapeBriefText).join(", ")})` : "fetched";
  } else {
    status = `${link.status} (${escapeBriefText(link.reason ?? "unknown")})`;
  }
  if (link.status === "blocked" && link.reason === "not_public_host") return `- \`${codeUrl(link.url)}\` - ${status}`;
  let label = link.title?.trim() || "";
  if (!label) {
    try {
      const u = new URL(link.url);
      label = `${bareHost(u.hostname)}${u.pathname === "/" ? "" : u.pathname}`;
    } catch {
      label = link.url;
    }
  }
  return `- [${linkText(label)}](${linkHref(link.url)}) - ${status}`;
}

function sourcesBlock(links: readonly GigBriefLink[]): string[] {
  const lines = [`## ${GIG_BRIEF_HEADINGS.sources}`];
  if (links.length === 0) lines.push("The listing links to nothing kp could read.");
  else lines.push(...links.map(sourceLine));
  return lines;
}

/** The model's brief as Markdown, in the one fixed shape every brief shares. */
export function assembleGigBriefMarkdown(result: GigBriefModelResult, links: readonly GigBriefLink[]): string {
  const lines: string[] = [];
  lines.push(`## ${GIG_BRIEF_HEADINGS.what}`, escapeBriefText(result.summary), "");
  lines.push(`## ${GIG_BRIEF_HEADINGS.asks}`);
  if (result.asks.length === 0) lines.push("The listing states no deliverables.");
  else lines.push(...result.asks.map((a) => `- ${escapeBriefText(a)}`));
  lines.push("");
  lines.push(`## ${GIG_BRIEF_HEADINGS.difficulty}`);
  const parts = [`**${DIFFICULTY_LABEL[result.difficulty]}**${result.difficultyReason ? ` - ${sentence(result.difficultyReason)}.` : "."}`];
  if (result.effort) {
    const { minHours, maxHours } = result.effort;
    parts.push(minHours === maxHours ? `Estimated **${formatHours(minHours)} h**.` : `Estimated **${formatHours(minHours)}-${formatHours(maxHours)} h**.`);
    if (result.effort.note) parts.push(`${sentence(result.effort.note)}.`);
  } else {
    parts.push("No effort estimate.");
  }
  lines.push(parts.join(" "), "");
  lines.push(`## ${GIG_BRIEF_HEADINGS.challenges}`);
  if (result.challenges.length === 0) lines.push("None named.");
  else lines.push(...result.challenges.map((c) => `- ${escapeBriefText(c)}`));
  lines.push("");
  lines.push(...sourcesBlock(links));
  return lines.join("\n");
}

/** The listing's first paragraphs (at most 4, about 900 characters), escaped. */
function listingParagraphs(bodyText: string): string[] {
  const out: string[] = [];
  let total = 0;
  for (const raw of String(bodyText ?? "").split(/\n+/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const cut = line.length > 500 ? `${line.slice(0, 499)}…` : line;
    out.push(escapeBriefText(cut));
    total += cut.length;
    if (out.length >= 4 || total >= 900) break;
  }
  return out;
}

/** The deterministic brief's Markdown: the listing's first paragraphs and the links. */
export function assembleDeterministicMarkdown(gig: Pick<Gig, "bodyText">, links: readonly GigBriefLink[]): string {
  const paragraphs = listingParagraphs(gig.bodyText);
  const lines: string[] = [`## ${GIG_BRIEF_HEADINGS.what}`];
  if (paragraphs.length === 0) lines.push("The listing carries no text.");
  else paragraphs.forEach((p, i) => lines.push(...(i > 0 ? ["", p] : [p])));
  lines.push("");
  lines.push(...sourcesBlock(links));
  return lines.join("\n");
}

function clampText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function clampList(v: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const s = clampText(item, maxChars);
    if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** kp's gate on the CLI's `result` (the Python coercer is the first line; this is the
 *  one that decides what is stored). Null when a required field is missing. */
export function parseGigBriefResult(raw: unknown): GigBriefModelResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const category = clampText(r.category, 80);
  const title = clampText(r.title, 200);
  const summary = clampText(r.summary, 900);
  if (!category || !title || !summary) return null;
  const difficulty: GigDifficulty = isGigDifficulty(r.difficulty) ? r.difficulty : "unrated";
  const difficultyReason = difficulty === "unrated" ? null : clampText(r.difficultyReason, 300);
  let effort: GigBriefModelResult["effort"] = null;
  const e = r.effort && typeof r.effort === "object" && !Array.isArray(r.effort) ? (r.effort as Record<string, unknown>) : null;
  if (e) {
    const min = typeof e.minHours === "number" && Number.isFinite(e.minHours) ? e.minHours : NaN;
    const max = typeof e.maxHours === "number" && Number.isFinite(e.maxHours) ? e.maxHours : NaN;
    if (min > 0 && max >= min && max <= 2000) {
      effort = { minHours: Math.round(min * 10) / 10, maxHours: Math.round(max * 10) / 10, note: clampText(e.note, 200) };
    }
  }
  return {
    category,
    title,
    difficulty,
    difficultyReason,
    effort,
    challenges: clampList(r.challenges, 7, 240),
    summary,
    asks: clampList(r.asks, 8, 240),
  };
}

/** The retitle keeps its category up front: a title that does not already start with the
 *  category's first segment gets it ("Web security" + "Stored XSS in bio"). */
function retitle(category: string, title: string): string {
  const head = category.split(" · ")[0]?.trim() ?? category;
  if (!head || title.toLowerCase().startsWith(head.toLowerCase())) return title;
  const joined = `${head} · ${title}`;
  return joined.length > 200 ? `${joined.slice(0, 199)}…` : joined;
}

/** A brief from the model's result. Markdown and sections are written together, here. */
export function buildLlmGigBrief(
  result: GigBriefModelResult,
  links: GigBriefLink[],
  meta: { promptVersion: string; createdAt: string }
): GigBrief {
  const markdown = assembleGigBriefMarkdown(result, links);
  return {
    version: 1,
    category: result.category,
    title: retitle(result.category, result.title),
    difficulty: result.difficulty,
    difficultyReason: result.difficulty === "unrated" ? null : result.difficultyReason,
    effort: result.effort,
    challenges: result.challenges,
    markdown,
    sections: parseGigBriefSections(markdown),
    links,
    source: "llm",
    fallbackReason: null,
    promptVersion: meta.promptVersion,
    createdAt: meta.createdAt,
  };
}

/** The keyless / refused / failed brief: category from the arena and the first tag, the
 *  listing retitled with its arena, `unrated`, no effort, no challenges, and the listing's
 *  first paragraphs plus every link's line. Stored, because the link list is the part the
 *  operator cannot get any other way. */
export function deterministicGigBrief(
  gig: Pick<Gig, "arena" | "title" | "tags" | "bodyText">,
  links: GigBriefLink[],
  fallbackReason: string,
  createdAt: string
): GigBrief {
  const arena = GIG_ARENA_LABEL[gig.arena] ?? "Gig";
  const tag = gig.tags.map((t) => t.replace(/\s+/g, " ").trim()).find(Boolean);
  const category = (tag ? `${arena} · ${tag}` : arena).slice(0, 80);
  const titleRaw = `${arena} · ${gig.title.replace(/\s+/g, " ").trim()}`;
  const markdown = assembleDeterministicMarkdown(gig, links);
  return {
    version: 1,
    category,
    title: titleRaw.length > 200 ? `${titleRaw.slice(0, 199)}…` : titleRaw,
    difficulty: "unrated",
    difficultyReason: null,
    effort: null,
    challenges: [],
    markdown,
    sections: parseGigBriefSections(markdown),
    links,
    source: "deterministic",
    fallbackReason,
    promptVersion: GIG_BRIEF_PROMPT_VERSION,
    createdAt,
  };
}

// ---------------------------------------------------------------------------
// 3. Reading the links (effectful, injected)
// ---------------------------------------------------------------------------

export type GigResearchDeps = {
  fetch: PoliteFetch;
  githubRead: <T>(url: string) => Promise<GithubReadOutcome<T>>;
  /** DNS for the egress guard. */
  lookup: HostLookup;
  offline: () => boolean;
  runCli: CliRunner;
  scanHoneypots: typeof scanGigForHoneypots;
  getGig: typeof getGig;
  setGigBrief: typeof setGigBrief;
  transitionGig: typeof transitionGig;
  mergeGigSuspectReasons: typeof mergeGigSuspectReasons;
  listGigsNeedingBrief: typeof listGigsNeedingBrief;
  now: () => string;
  nowMs: () => number;
  log: (line: string, error?: unknown) => void;
};

async function dnsLookup(host: string): Promise<Array<{ address: string }>> {
  // Lazy: node:dns stays off every graph until a link is actually vetted.
  const { lookup } = await import("node:dns/promises");
  return lookup(host, { all: true, verbatim: true });
}

export function defaultGigResearchDeps(): GigResearchDeps {
  return {
    fetch: politeFetch,
    githubRead,
    lookup: dnsLookup,
    offline: () => isOffline(),
    runCli: runPythonCli,
    scanHoneypots: scanGigForHoneypots,
    getGig,
    setGigBrief,
    transitionGig,
    mergeGigSuspectReasons,
    listGigsNeedingBrief,
    now: () => new Date().toISOString(),
    nowMs: () => Date.now(),
    log: (line, error) => (error === undefined ? console.warn(`[gigs:research] ${line}`) : console.error(`[gigs:research] ${line}`, error)),
  };
}

/** One page the model may read, as data. */
type ResearchPage = { url: string; title: string | null; text: string };

type LinkRead = { link: GigBriefLink; page: ResearchPage | null; flagged: GigSuspectReason[] };

/** kp's egress guard, BEFORE any byte: https + public DNS name + every resolved address
 *  public (ats-egress-guard.ts). An http link is vetted on the same host rules. Null =
 *  allowed. A lookup that failed or found nothing is `failed: dns_unresolved`; everything
 *  else the guard refuses (IP literal, internal/loopback name, a private address) is
 *  `blocked: not_public_host`. */
async function vetLink(href: string, lookup: HostLookup): Promise<{ status: "blocked" | "failed"; reason: string } | null> {
  const httpsForm = href.replace(/^http:/i, "https:");
  let lookupFailed = false;
  const probe: HostLookup = async (host) => {
    try {
      const found = await lookup(host);
      if (found.length === 0) lookupFailed = true;
      return found;
    } catch (error) {
      lookupFailed = true;
      throw error;
    }
  };
  try {
    await assertPublicHttpsEndpointResolved(httpsForm, "gig link", probe);
    return null;
  } catch {
    return lookupFailed ? { status: "failed", reason: "dns_unresolved" } : { status: "blocked", reason: "not_public_host" };
  }
}

/** `github.com/<o>/<r>/issues|pull/<n>` or a repository root, as a GitHub API read. */
function githubTarget(href: string): { kind: "issue"; api: string } | { kind: "repo"; api: string; readme: string } | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (!GITHUB_HOSTS.has(u.hostname.toLowerCase())) return null;
  const segs = u.pathname.split("/").filter(Boolean);
  const safe = (s: string) => /^[A-Za-z0-9_.-]+$/.test(s);
  if (segs.length < 2 || !safe(segs[0]) || !safe(segs[1])) return null;
  const repo = `${segs[0]}/${segs[1].replace(/\.git$/, "")}`;
  if (segs.length >= 4 && (segs[2] === "issues" || segs[2] === "pull") && /^\d+$/.test(segs[3])) {
    return { kind: "issue", api: `https://api.github.com/repos/${repo}/issues/${segs[3]}` };
  }
  if (segs.length === 2 || (segs.length >= 3 && segs[2] === "tree")) {
    return { kind: "repo", api: `https://api.github.com/repos/${repo}`, readme: `https://api.github.com/repos/${repo}/readme` };
  }
  return null;
}

function githubFailure(url: string, out: Exclude<GithubReadOutcome<unknown>, { ok: true }>): LinkRead {
  if (out.kind === "offline") return { link: { url, title: null, status: "skipped", reason: "offline", chars: null }, page: null, flagged: [] };
  const reason = out.kind === "throttled" ? "throttled" : out.kind === "not_found" ? "not_found" : out.kind;
  return { link: { url, title: null, status: "failed", reason, chars: null }, page: null, flagged: [] };
}

function pageRead(url: string, title: string | null, fullText: string, html: string | null, deps: GigResearchDeps): LinkRead {
  const text = fullText.slice(0, GIG_RESEARCH_PAGE_CHARS);
  if (!text.trim()) return { link: { url, title, status: "failed", reason: "no_text", chars: 0 }, page: null, flagged: [] };
  const flagged = deps.scanHoneypots({ title: title ?? "", bodyText: text, bodyHtml: html ? html.slice(0, HONEYPOT_HTML_CHARS) : null });
  const cleanTitle = title ? title.replace(/\s+/g, " ").trim().slice(0, 200) || null : null;
  return {
    link: { url, title: cleanTitle, status: "fetched", reason: flagged.length > 0 ? `suspect:${flagged.join(",")}` : null, chars: text.length },
    page: { url, title: cleanTitle, text },
    flagged,
  };
}

async function readGithub(url: string, target: NonNullable<ReturnType<typeof githubTarget>>, deps: GigResearchDeps): Promise<LinkRead> {
  if (target.kind === "issue") {
    const out = await deps.githubRead<{ title?: unknown; body?: unknown; state?: unknown }>(target.api);
    if (!out.ok) return githubFailure(url, out);
    const title = typeof out.data?.title === "string" ? out.data.title : null;
    const body = typeof out.data?.body === "string" ? out.data.body : "";
    const state = typeof out.data?.state === "string" ? `State: ${out.data.state}\n\n` : "";
    return pageRead(url, title, `${title ?? ""}\n\n${state}${body}`.trim(), null, deps);
  }
  const repo = await deps.githubRead<{ full_name?: unknown; description?: unknown }>(target.api);
  if (!repo.ok) return githubFailure(url, repo);
  const readme = await deps.githubRead<{ content?: unknown; encoding?: unknown }>(target.readme);
  let readmeText = "";
  if (readme.ok && typeof readme.data?.content === "string" && readme.data.encoding === "base64") {
    readmeText = Buffer.from(readme.data.content, "base64").toString("utf8");
  }
  const title = typeof repo.data?.full_name === "string" ? repo.data.full_name : null;
  const description = typeof repo.data?.description === "string" ? repo.data.description : "";
  return pageRead(url, title, [description, readmeText].filter(Boolean).join("\n\n"), null, deps);
}

async function readPage(url: string, deps: GigResearchDeps): Promise<LinkRead> {
  // Every redirect hop is vetted like the first request: a public link must not bounce
  // the fetch onto a private address (SSRF through a redirect).
  const hopGuard = async (next: URL): Promise<string | null> => (await vetLink(next.href, deps.lookup))?.reason ?? null;
  const out = await deps.fetch(url, { sourceId: RESEARCH_FETCH_SOURCE, accept: RESEARCH_ACCEPT, hopGuard });
  if (out.kind !== "ok") {
    const link = (status: GigBriefLink["status"], reason: string): LinkRead => ({ link: { url, title: null, status, reason, chars: null }, page: null, flagged: [] });
    switch (out.kind) {
      case "offline":
        return link("skipped", "offline");
      case "robots_disallowed":
        return link("blocked", "robots_disallowed");
      case "blocked":
        return link("blocked", out.detail || "denied");
      case "gone":
        return link("failed", "not_found");
      case "outage":
        return link("failed", out.detail || "outage");
      default:
        return link("failed", "unknown");
    }
  }
  const type = out.contentType;
  if (type.includes("text/html") || type.includes("application/xhtml")) {
    return pageRead(url, htmlTitle(out.body), htmlToText(out.body), out.body, deps);
  }
  if (!type || type.startsWith("text/") || type.includes("json") || type.includes("markdown")) {
    return pageRead(url, null, out.body, null, deps);
  }
  return { link: { url, title: null, status: "skipped", reason: "unsupported_type", chars: null }, page: null, flagged: [] };
}

// ---------------------------------------------------------------------------
// 4. One gig, and a batch
// ---------------------------------------------------------------------------

export type GigResearchOptions = {
  /** The listing's raw HTML when the caller has it (the scan does; the row does not). */
  bodyHtml?: string | null;
  signal?: AbortSignal;
  /** `deterministic` = no spawn (a batch after the first `no_provider`). */
  mode?: "auto" | "deterministic";
  /** The fallback reason a `deterministic` run records (default `no_provider`). */
  fallbackReason?: string;
  deps?: Partial<GigResearchDeps>;
};

export type GigResearchOutcome = {
  /** The gig as stored with its new brief; null when it left this workspace mid-run. */
  gig: Gig | null;
  brief: GigBrief;
  /** The CLI answered `no_provider`: the caller stops spawning for this batch. */
  providerMissing: boolean;
  /** Honeypot reasons the linked pages carried ([] = none). */
  flagged: GigSuspectReason[];
};

function joinedBudget(outer: AbortSignal | undefined, ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("gig research: budget exhausted")), ms);
  const onOuter = () => controller.abort(outer?.reason);
  if (outer?.aborted) onOuter();
  else outer?.addEventListener("abort", onOuter, { once: true });
  return {
    signal: controller.signal,
    release: () => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onOuter);
    },
  };
}

/** Honeypot reasons from a linked page: a `new`/`qualified` gig moves to `suspect`
 *  through the ordinary transition (CAS); any other status keeps its place and records
 *  the reasons. Answers the gig as it now stands. */
function flagGig(workspaceId: string, gig: Gig, reasons: readonly GigSuspectReason[], deps: GigResearchDeps): Gig {
  const fresh = deps.getGig(workspaceId, gig.id) ?? gig;
  if (fresh.status === "new" || fresh.status === "qualified") {
    const merged = [...new Set([...fresh.suspectReasons, ...reasons])].filter(isGigSuspectReason);
    const moved = deps.transitionGig(workspaceId, gig.id, { from: fresh.status, to: "suspect", patch: { suspectReasons: merged } });
    if (moved.ok) return moved.gig;
  }
  return deps.mergeGigSuspectReasons(workspaceId, gig.id, reasons) ?? fresh;
}

/** The CLI's input: the listing and the pages, both of which the CLI fences as data. */
function cliInput(gig: Gig, pages: readonly ResearchPage[]) {
  return {
    listing: {
      title: gig.title,
      org: gig.org,
      arena: gig.arena,
      url: gig.url,
      reward: gig.reward?.text ?? null,
      deadlineAt: gig.deadlineAt,
      tags: gig.tags,
      body: gig.bodyText.slice(0, GIG_RESEARCH_PAGE_CHARS),
    },
    pages,
  };
}

/** Research ONE gig: read its links, flag it if a page is a honeypot, write the brief. */
export async function researchGig(workspaceId: string, gig: Gig, opts: GigResearchOptions = {}): Promise<GigResearchOutcome> {
  const deps: GigResearchDeps = { ...defaultGigResearchDeps(), ...opts.deps };
  const startedMs = deps.nowMs();
  const budget = joinedBudget(opts.signal, GIG_RESEARCH_BUDGET_MS);
  try {
    const urls = extractGigLinks({ url: gig.url, bodyText: gig.bodyText, bodyHtml: opts.bodyHtml ?? null });
    const links: GigBriefLink[] = [];
    const pages: ResearchPage[] = [];
    const flagged = new Set<GigSuspectReason>();
    let suspect = gig.status === "suspect";
    for (const url of urls) {
      const skip = (reason: string) => links.push({ url, title: null, status: "skipped", reason, chars: null });
      // A suspect listing's links are listed, never followed: a honeypot's link is where
      // it learns an automated reader came by.
      if (suspect) skip("gig_suspect");
      else if (deps.offline()) skip("offline");
      else if (budget.signal.aborted) skip("budget");
      else {
        const refused = await vetLink(url, deps.lookup);
        if (refused) {
          links.push({ url, title: null, status: refused.status, reason: refused.reason, chars: null });
          continue;
        }
        const target = githubTarget(url);
        let read: LinkRead;
        try {
          read = target ? await readGithub(url, target, deps) : await readPage(url, deps);
        } catch (error) {
          deps.log(`${gig.id}: reading a linked page threw`, error);
          read = { link: { url, title: null, status: "failed", reason: "read_error", chars: null }, page: null, flagged: [] };
        }
        links.push(read.link);
        if (read.page) pages.push(read.page);
        if (read.flagged.length > 0) {
          read.flagged.forEach((r) => flagged.add(r));
          suspect = true;
        }
      }
    }

    let current = gig;
    if (flagged.size > 0) current = flagGig(workspaceId, gig, [...flagged], deps);

    let brief: GigBrief | null = null;
    let providerMissing = false;
    let fallbackReason: string;
    const remaining = GIG_RESEARCH_BUDGET_MS - (deps.nowMs() - startedMs);
    if (suspect || current.status === "suspect") fallbackReason = "gig_suspect";
    else if (opts.mode === "deterministic") fallbackReason = opts.fallbackReason ?? "no_provider";
    else if (budget.signal.aborted || remaining < LLM_MIN_REMAINING_MS) fallbackReason = "budget";
    else {
      fallbackReason = "llm_unusable";
      try {
        const out = await deps.runCli({
          module: "gig_brief_cli",
          files: { "input.json": cliInput(current, pages) },
          args: (f) => ["--input-json", f["input.json"]],
          signal: budget.signal,
          llm: true,
          timeoutMs: Math.max(5_000, Math.min(LLM_SPAWN_TIMEOUT_MS, remaining - 1_000)),
        });
        const result = out.source === "llm" ? parseGigBriefResult(out.result) : null;
        if (result) {
          const promptVersion = typeof out.promptVersion === "string" && out.promptVersion ? out.promptVersion : GIG_BRIEF_PROMPT_VERSION;
          brief = buildLlmGigBrief(result, links, { promptVersion, createdAt: deps.now() });
        } else if (typeof out.fallbackReason === "string" && out.fallbackReason) {
          fallbackReason = out.fallbackReason.slice(0, 120);
          providerMissing = out.fallbackReason === "no_provider";
        }
      } catch (error) {
        deps.log(`${gig.id}: the brief engine failed; writing the deterministic brief`, error);
        fallbackReason = "engine_error";
      }
    }
    if (!brief) brief = deterministicGigBrief(current, links, fallbackReason, deps.now());
    const stored = deps.setGigBrief(workspaceId, gig.id, brief);
    return { gig: stored, brief, providerMissing, flagged: [...flagged] };
  } finally {
    budget.release();
  }
}

/** The scan's research pass (GigResearchHook): brief up to `limit` gigs with no brief,
 *  newest first. The first `no_provider` switches the rest to deterministic briefs with no
 *  further spawn. Stops between gigs when the scan's budget or the caller fires. */
export async function researchGigBatch(
  workspaceId: string,
  info: { signal: AbortSignal; limit: number; sourceId: string | null; htmlByGigId: ReadonlyMap<string, string | null> },
  depsOverride: Partial<GigResearchDeps> = {}
): Promise<GigResearchBatchSummary> {
  const deps: GigResearchDeps = { ...defaultGigResearchDeps(), ...depsOverride };
  const summary: GigResearchBatchSummary = { attempted: 0, llm: 0, deterministic: 0, failed: 0, flagged: 0, providerMissing: false };
  const gigs = deps.listGigsNeedingBrief(workspaceId, info.limit, { sourceId: info.sourceId });
  for (const gig of gigs) {
    if (info.signal.aborted) break;
    summary.attempted += 1;
    try {
      const out = await researchGig(workspaceId, gig, {
        bodyHtml: info.htmlByGigId.get(gig.id) ?? null,
        signal: info.signal,
        mode: summary.providerMissing ? "deterministic" : "auto",
        deps,
      });
      if (!out.gig) summary.failed += 1;
      else if (out.brief.source === "llm") summary.llm += 1;
      else summary.deterministic += 1;
      if (out.flagged.length > 0) summary.flagged += 1;
      if (out.providerMissing) summary.providerMissing = true;
    } catch (error) {
      summary.failed += 1;
      deps.log(`${gig.id}: research failed`, error);
    }
  }
  return summary;
}
