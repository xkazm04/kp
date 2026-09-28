// The job-seeker flow under /me ("The Sieve"), LIVE: the operator's own CV, real job
// boards, a real scan. The keyless twin (jobseeker-keyless.spec.ts) pins the flow's EMPTY
// states; this one walks it end to end the way its owner does, and ends where the flow
// promises to end — AI-engineering postings ranked, one opened, one decided — with every
// section photographed in both themes, on a desktop and on a phone, for design review.
//
// RUN IT THROUGH THE ONE COMMAND, not by hand:
//   KP_ME_LIVE_CV=/path/to/your-cv.pdf node scripts/e2e/me-live.mjs
// The runner boots an ISOLATED `next dev` (KP_EMPTY=1, so the .next-empty distDir; a
// FRESH data/kp-me-live.sqlite; KP_JOBSEEKER=1; port KP_ME_LIVE_PORT, default 3107),
// points this file at it with KP_E2E_BASE_URL, and takes it down afterwards. It never
// touches data/kp.sqlite or the operator's own dev server, and it refuses (naming the
// holder) when the port or .next-empty/dev/lock is taken. Pointed at any other server by
// hand, step a still refuses one that already has a seeker: this spec CREATES the seeker,
// and must never write over one.
//
// WHAT IT TOUCHES. The network, for real, tier A only: EURES (europa.eu), Arbeitnow, the
// MPSV open-data file (data.mpsv.cz), and the public ATS boards in KP_ME_LIVE_BOARDS
// (default: Anthropic and Helsing on Greenhouse, OpenAI, ElevenLabs, Cohere and Apify -
// Prague - on Ashby, Spotify on Lever, Hugging Face on Workable; each checked to answer
// with open roles on 2026-09-28, when Google DeepMind's Greenhouse board was gone (404) and
// Mistral's Lever board empty). It never accepts a tier-B board's
// terms — that acceptance is the owner's to give, and a test must not give it on their
// behalf — and never touches tier C. The CV read may call the AI model the install is
// configured with. Allow ~45 minutes; the scan alone may take 35.
//   KP_ME_LIVE_COUNTRIES  default cz,de,at,nl,pl        (typed into the Places card)
//   KP_ME_LIVE_TITLES     default AI Engineer,LLM Engineer,Machine Learning Engineer
//   KP_ME_LIVE_BOARDS     default greenhouse:anthropic,greenhouse:helsing,ashby:openai,
//                         ashby:elevenlabs,ashby:cohere,ashby:apify,lever:spotify,
//                         workable:huggingface
//
// PRIVACY. The CV is personal data and nothing personal is committed: its path comes from
// KP_ME_LIVE_CV only, and every assertion compares what the app itself read (the name the
// CV step shows equals the displayName GET /api/jobseeker/profile returned) — never a
// literal, and never printed: once the CV is read, the words of the name are scrubbed from
// every line this spec prints or reports. Screenshots, the PDF and report.md land in
// test-results/me-live/ (gitignored); the report holds public job ads and COUNTS of the
// operator's own data, nothing more.
//
// DELIBERATELY OUTSIDE KEYLESS_SPECS (playwright.config.ts) and outside CI: it needs a real
// CV, the network and the better part of an hour, and a gate that depends on today's job
// market goes red for reasons no commit caused. Inert unless KP_ME_LIVE_CV is set.
//
// HOW IT FAILS. Serial, ONE page for the whole walk (the scan is only as good as the wants
// typed before it). Only what makes the rest meaningless stops the walk: no profile after
// the read, a scan that never ends. Everything else is a CHECK — logged the moment it
// fails, then the walk carries on (a broken PDF must not cost the 35-minute scan or the
// screenshots), and the last test fails listing every failed check and every page error or
// console error the run collected. Where the UI refuses and the API can stand in (a want
// that did not persist, a board the form could not add), the check fails or the finding is
// recorded AND the API does the step, so the walk still reaches the results.
import fs from "node:fs";
import path from "node:path";
import { expect, request, test, type APIRequestContext, type BrowserContext, type Locator, type Page, type Response as PwResponse } from "@playwright/test";
import type { JobseekerCvListItem, JobseekerPostingSummary, JobseekerPreferences, JobseekerProfile, JobseekerSource, ScanSummary } from "../app/_lib/jobseeker/types";
import type { CatalogEntryView } from "../app/features/jobseeker/sourcesApi";
import type { Task } from "../app/features/shell/tasks/tasksProviderTypes";
import { twinKey } from "../app/features/jobseeker/sieve/sieveModel";
import { E2E_BASE_URL, seedDevAuth } from "./dev-auth";

// ── what the operator asked for (env; nothing here is personal) ─────────────────────────

const CV_PATH = process.env.KP_ME_LIVE_CV?.trim() ?? "";

function listEnv(name: string, fallback: string): string[] {
  return (process.env[name]?.trim() || fallback)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const CITY = "Praha";
const COUNTRIES = listEnv("KP_ME_LIVE_COUNTRIES", "cz,de,at,nl,pl").map((c) => c.toLowerCase());
const TITLES = listEnv("KP_ME_LIVE_TITLES", "AI Engineer,LLM Engineer,Machine Learning Engineer");
const BOARDS = listEnv("KP_ME_LIVE_BOARDS", "greenhouse:anthropic,greenhouse:helsing,ashby:openai,ashby:elevenlabs,ashby:cohere,ashby:apify,lever:spotify,workable:huggingface");

const OUT = path.resolve(import.meta.dirname, "..", "test-results", "me-live");
const MIN = 60_000;
const READ_TIMEOUT = 4 * MIN;
const SCAN_TIMEOUT = 35 * MIN;
/** A scan stops at its 8-minute wall budget (scan.ts SCAN_WALL_BUDGET_MS) and RESUMES
 *  where it stopped on the next one: a big company board (OpenAI's alone is 300 postings)
 *  needs structuring passes of its own. The walk scans again while postings still wait
 *  for a score, at most this many times in all, within SCAN_BUDGET. */
const SCAN_PASSES = 5;
const SCAN_BUDGET = 60 * MIN;
const PDF_TIMEOUT = 3 * MIN;

const STEPS = ["arrive", "cv", "want", "sieve", "evening", "weigh", "sources"] as const;
type StepId = (typeof STEPS)[number];

/** The config key each ATS adapter reads its company from (app/_lib/jobseeker/adapters/
 *  registry.ts, hostForAdapter). The catalog ids are the vendor names. */
const ATS_KEY: Readonly<Record<string, string>> = {
  greenhouse: "token",
  lever: "site",
  ashby: "board",
  workable: "subdomain",
  recruitee: "company",
  teamtailor: "company",
  personio: "company",
  smartrecruiters: "company",
};

/** The three open feeds, found by their switch's accessible name (the catalog label). */
const FEEDS = [
  { catalogId: "eures", adapter: "eures", label: "EURES", name: /eures/i },
  { catalogId: "arbeitnow", adapter: "arbeitnow", label: "Arbeitnow", name: /arbeitnow/i },
  { catalogId: "mpsv", adapter: "mpsv_bulk", label: "MPSV", name: /mpsv/i },
] as const;

// ── every place this spec leans on markup instead of a role or a name ───────────────────
// /me is being redesigned while this is written. The stable anchors are the section ids,
// accessible names, and the Want card's view / Done / Cancel contract; the few lookups
// that need a class or an attribute live here, so when the markup moves the fix is one
// line.
const ui = {
  step: (p: Page, id: StepId) => p.locator(`#s-${id}`),
  /** The heading a section is labelled by (aria-labelledby="h-<id>"). */
  stepTitle: (p: Page, id: StepId) => p.locator(`#s-${id} #h-${id}`),
  cvFile: (p: Page) => p.locator("#s-arrive input[type=file]"),
  wantCard: (p: Page, heading: RegExp) => p.locator("#s-want .wcard").filter({ has: p.getByRole("heading", { name: heading }) }),
  /** A Want card's VIEW layer: the whole card is one button (WantCard.tsx, SV_WANT_VIEW). */
  wantView: (card: Locator) => card.locator(".wview"),
  layoutPicker: (cv: Locator) => cv.getByRole("group", { name: /layout|template/i }),
  designedSheet: (cv: Locator) => cv.getByRole("figure").first(),
  topCards: (evening: Locator) => evening.locator(".top5").getByRole("button"),
  /** The rows are still paging in (StepSieve's loading stage says aria-busy). */
  sieveLoading: (p: Page) => p.locator('#s-sieve [aria-busy="true"]'),
};

// ── what the walk collects ──────────────────────────────────────────────────────────────

type Check = { step: string; label: string; ok: boolean; detail: string | null };
type Issue = { step: string; kind: "pageerror" | "console"; text: string; url: string; status: number | null };
type HttpError = { step: string; method: string; url: string; status: number };
type Tolerance = { why: string; match(issue: Issue): boolean };
type BoardPlan = { spec: string; vendor: string; slug: string; key: string; entry: CatalogEntryView };
type Facts = ReturnType<typeof factsOf>;

const run = {
  step: "setup",
  startedAt: new Date(),
  checks: [] as Check[],
  issues: [] as Issue[],
  httpErrors: [] as HttpError[],
  findings: [] as string[],
  sourceFailures: [] as string[],
  cv: null as null | { skills: number; evidence: number; languages: number; reader: string },
  layouts: [] as string[],
  pdf: null as string | null,
  boards: [] as { spec: string; sourceId: string; via: "the Sources form" | "the API" }[],
  scan: null as null | { taskId: string; status: string; error: string | null; seconds: number; summary: ScanSummary | null },
  /** The follow-up passes (SCAN_PASSES): how many waited before each, and how it ended. */
  scanPasses: [] as { pass: number; waitingBefore: number; status: string; seconds: number; matched: number | null }[],
  postings: null as JobseekerPostingSummary[] | null,
  sources: null as JobseekerSource[] | null,
  opened: null as null | { id: string; title: string; shortlisted: boolean },
  loadedResults: false,
  shots: [] as string[],
};

/** Console errors the run has itself explained. Anything else fails the last test. */
const tolerances: Tolerance[] = [
  {
    why: "a request the page itself cancelled (a navigation or an AbortController): nothing failed",
    match: (i) => i.kind === "console" && /net::ERR_ABORTED/.test(i.text),
  },
];

function tolerate(why: string, pathname: RegExp, status: number): void {
  if (tolerances.some((t) => t.why === why)) return;
  tolerances.push({ why, match: (i) => i.kind === "console" && i.status === status && pathname.test(issuePath(i)) });
}

/** The path a failed load was for: the console message's own location, else the failed
 *  response seen in the same step with the same status. */
function issuePath(i: Issue): string {
  const url = i.url || run.httpErrors.find((h) => h.step === i.step && h.status === i.status)?.url || "";
  return pathnameOf(url);
}

function unexplained(): Issue[] {
  return run.issues.filter((i) => !tolerances.some((t) => t.match(i)));
}

let api: APIRequestContext;
let context: BrowserContext;
let page: Page;

// ── small helpers ───────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const ESC = String.fromCharCode(27);

/** The words of the operator's own name, once the CV is read. A failing expect quotes the
 *  text it saw and the page says the name (the rail, the Arrive heading), so every line
 *  this spec prints or reports is scrubbed of them. */
const privateWords: RegExp[] = [];

function scrub(text: string): string {
  return privateWords.reduce((out, re) => out.replace(re, "[name]"), text);
}

function note(text: string): void {
  console.log(`[me-live ${run.step}] ${scrub(text)}`);
}

/** An error's first meaningful line, without the terminal colours expect() adds. */
function firstLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const plain = text.split(ESC).map((part, i) => (i === 0 ? part : part.replace(/^\[[0-9;]*m/, ""))).join("");
  return scrub((plain.split("\n").map((l) => l.trim()).find(Boolean) ?? "").slice(0, 300));
}

function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    /* not an absolute URL (an empty console location): match on what there is */
    return url;
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A whole-word matcher, so "AT" is Austria and not the inside of another word. */
function wordRe(s: string, flags = ""): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(s)}(?![\\p{L}\\p{N}])`, `u${flags}`);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "layout";
}

function clock(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Want items not in `have`, compared the way addToken dedupes them (case-insensitively). */
function missing(have: readonly string[] | undefined, want: readonly string[]): string[] {
  const got = new Set((have ?? []).map((x) => x.toLowerCase()));
  return want.filter((w) => !got.has(w.toLowerCase()));
}

function union(have: readonly string[] | undefined, add: readonly string[]): string[] {
  return [...(have ?? []), ...missing(have, add)];
}

/**
 * A check that must hold but must not end the walk: logged at once, collected, and failed
 * together by the last test. Returns whether it held.
 */
async function check(label: string, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    run.checks.push({ step: run.step, label, ok: true, detail: null });
    note(`✓ ${label}`);
    return true;
  } catch (error) {
    // Collected, not rethrown: the last test fails with every one of these (header, "HOW IT FAILS").
    const detail = firstLine(error);
    run.checks.push({ step: run.step, label, ok: false, detail });
    note(`✗ ${label} — ${detail}`);
    test.info().annotations.push({ type: "failed check", description: `${label} — ${detail}` });
    return false;
  }
}

/** A screenshot for the design review. A failed one is a failed check, never the end. */
async function shot(target: Page | Locator, rel: string): Promise<void> {
  const file = path.join(OUT, rel);
  try {
    if ("goto" in target) {
      // The flow reveals its chapters with SCROLL-DRIVEN animations (sieve.css): a
      // full-page capture never scrolls, so everything below the fold would sit at its
      // first keyframe. Reduced motion is the page's own "finished" state - use it.
      await target.emulateMedia({ reducedMotion: "reduce" });
      try {
        await target.screenshot({ path: file, fullPage: true, animations: "disabled" });
      } finally {
        await target.emulateMedia({ reducedMotion: null });
      }
    } else await target.screenshot({ path: file, animations: "disabled" });
    run.shots.push(rel);
  } catch (error) {
    // Collected like any check: one missing picture must not cost the rest of the capture.
    run.checks.push({ step: run.step, label: `screenshot ${rel}`, ok: false, detail: firstLine(error) });
    note(`✗ screenshot ${rel} — ${firstLine(error)}`);
  }
}

/** The fonts and two frames: what a layout switch or a theme flip needs before a picture. */
async function settle(p: Page): Promise<void> {
  await p.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

/** Re-skin in place: the attribute the token seam reads, the stored choice, and the storage
 *  event app/_lib/theme.ts listens to, so a behavioural fork (useTheme) follows as well. */
async function applyTheme(p: Page, theme: "light" | "dark"): Promise<void> {
  await p.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await p.evaluate((next) => {
    try {
      localStorage.setItem("kp-theme", next);
    } catch {
      /* storage refused: the attribute below still re-skins the page */
    }
    if (next === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    window.dispatchEvent(new StorageEvent("storage", { key: "kp-theme", newValue: next }));
  }, theme);
  await settle(p);
}

/** Every action gets a ceiling. Playwright's default is none, so a click on a control that
 *  never enables would hold a CHECK until the test's own timeout — minutes of a walk spent
 *  on one soft failure. Navigations get longer: a dev server recompiles a changed page. */
function bound(ctx: BrowserContext): void {
  ctx.setDefaultTimeout(MIN);
  ctx.setDefaultNavigationTimeout(3 * MIN);
}

function watch(p: Page): void {
  p.on("pageerror", (error) => run.issues.push({ step: run.step, kind: "pageerror", text: firstLine(error), url: "", status: null }));
  p.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = scrub(msg.text().slice(0, 400));
    run.issues.push({ step: run.step, kind: "console", text, url: msg.location().url ?? "", status: Number(/status of (\d{3})/.exec(text)?.[1]) || null });
  });
  p.on("response", (r) => {
    if (r.status() >= 400) run.httpErrors.push({ step: run.step, method: r.request().method(), url: r.url(), status: r.status() });
  });
}

/**
 * Open /me and wait until the page is live and the rows are in. The first postings read is
 * an EFFECT, so its answer means the page hydrated: a click or a file set from here on lands
 * on a live handler, not on server HTML. The postings read is rate-limited (120 per 10 min
 * per IP) and every load pages the whole dataset, so a large scan can exhaust it: a throttled
 * load waits a minute and reloads, rather than failing the run over its own traffic.
 */
async function gotoMe(p: Page, url = "/me"): Promise<void> {
  for (let attempt = 1; attempt <= 12; attempt++) {
    const seen = { throttled: false, wait: 60 };
    const onResponse = (r: PwResponse) => {
      if (r.status() !== 429 || pathnameOf(r.url()) !== "/api/jobseeker/postings") return;
      seen.throttled = true;
      seen.wait = Number(r.headers()["retry-after"]) || 60;
    };
    p.on("response", onResponse);
    try {
      const hydrated = p
        .waitForResponse((r) => r.request().method() === "GET" && pathnameOf(r.url()) === "/api/jobseeker/postings", { timeout: 2 * MIN })
        .then(
          () => true,
          () => false
        );
      await p.goto(url);
      if (!(await hydrated)) note("no postings read after the load: carrying on without the hydration signal");
      await expect(ui.sieveLoading(p)).toHaveCount(0, { timeout: 3 * MIN });
    } finally {
      p.off("response", onResponse);
    }
    if (!seen.throttled) return;
    tolerate("GET /api/jobseeker/postings throttled the harness's own reloads (429); the load was retried", /^\/api\/jobseeker\/postings$/, 429);
    note(`GET /api/jobseeker/postings answered 429: waiting ${seen.wait}s for the limiter, then reloading (attempt ${attempt})`);
    await sleep(seen.wait * 1000);
  }
  throw new Error("GET /api/jobseeker/postings stayed throttled for twelve minutes");
}

// ── the API, as the walk reads it ───────────────────────────────────────────────────────

async function profileOf(): Promise<JobseekerProfile | null> {
  const res = await api.get("/api/jobseeker/profile");
  if (res.status() === 404) return null;
  if (!res.ok()) throw new Error(`GET /api/jobseeker/profile answered ${res.status()}`);
  return (await res.json()) as JobseekerProfile;
}

async function sourcesOf(): Promise<{ catalog: CatalogEntryView[]; sources: JobseekerSource[] }> {
  const res = await api.get("/api/jobseeker/sources");
  if (!res.ok()) throw new Error(`GET /api/jobseeker/sources answered ${res.status()}`);
  const body = (await res.json()) as { catalog?: CatalogEntryView[]; sources?: JobseekerSource[] };
  return { catalog: body.catalog ?? [], sources: body.sources ?? [] };
}

/** Every posting (status=all), paged with the keyset cursor. `patient` waits out the
 *  limiter on a 429; the report's last-chance read does not. */
async function allPostings(patient = true): Promise<JobseekerPostingSummary[]> {
  const rows: JobseekerPostingSummary[] = [];
  let cursor: string | null = null;
  let waits = 0;
  for (let pages = 0; pages < 500; pages++) {
    const qs = new URLSearchParams({ status: "all", limit: "100" });
    if (cursor) qs.set("cursor", cursor);
    const res = await api.get(`/api/jobseeker/postings?${qs.toString()}`);
    if (res.status() === 429 && patient && waits < 12) {
      waits++;
      note(`GET /api/jobseeker/postings answered 429: waiting a minute for the limiter (${waits})`);
      await sleep(Number(res.headers()["retry-after"]) * 1000 || MIN);
      continue;
    }
    if (!res.ok()) throw new Error(`GET /api/jobseeker/postings answered ${res.status()}`);
    const body = (await res.json()) as { rows?: JobseekerPostingSummary[]; nextCursor?: string | null };
    rows.push(...(body.rows ?? []));
    cursor = body.nextCursor ?? null;
    if (!cursor) break;
  }
  return rows;
}

async function putPreferences(patch: Partial<JobseekerPreferences>): Promise<void> {
  const res = await api.put("/api/jobseeker/profile", { data: { preferences: patch, preferencesReplace: true } });
  if (!res.ok()) throw new Error(`PUT /api/jobseeker/profile answered ${res.status()}`);
}

/** The source `find` names, or one created from its catalog entry through the API — the
 *  fallback when the UI could not; the caller has already recorded why. */
async function createSource(what: string, catalogId: string, config: Record<string, unknown> | null, find: (s: JobseekerSource) => boolean): Promise<JobseekerSource | null> {
  const existing = (await sourcesOf()).sources.find(find);
  if (existing) return existing;
  const res = await api.post("/api/jobseeker/sources", { data: { catalogId, ...(config ? { config } : {}) } });
  const body = (await res.json().catch(() => null)) as { source?: JobseekerSource; code?: string; field?: string; detail?: string } | null;
  if (res.status() === 201 && body?.source) return body.source;
  run.sourceFailures.push(`${what}: not created — POST /api/jobseeker/sources answered ${res.status()} ${body?.code ?? ""}${body?.field ? ` (field ${body.field})` : ""}${body?.detail ? ` ${body.detail}` : ""}`.trim());
  return null;
}

/** Switch a source on (or resume it) through the API. Tier A only ever reaches this: a
 *  tier-B source would answer 409 and ask for the owner's acknowledgement, never given here. */
async function enableSource(what: string, source: JobseekerSource): Promise<boolean> {
  if (source.enabled && !source.pausedReason) return true;
  const res = await api.patch(`/api/jobseeker/sources/${encodeURIComponent(source.id)}`, { data: source.pausedReason ? { resume: true } : { enabled: true } });
  if (res.ok()) return true;
  const body = (await res.json().catch(() => null)) as { code?: string } | null;
  run.sourceFailures.push(`${what}: not switched on — PATCH /api/jobseeker/sources/[id] answered ${res.status()} ${body?.code ?? ""}`.trim());
  return false;
}

function isTarget(r: JobseekerPostingSummary): boolean {
  return r.targetAlignment?.state === "target";
}

/** The ranking's order (sieveModel.ts compareScored): score, the narrower band, then id. */
function byScore(a: JobseekerPostingSummary, b: JobseekerPostingSummary): number {
  const d = (b.matchTotal ?? -1) - (a.matchTotal ?? -1);
  if (d) return d;
  const wa = a.confidence ? a.confidence.high - a.confidence.low : 100;
  const wb = b.confidence ? b.confidence.high - b.confidence.low : 100;
  return wa - wb || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** The sieve's layers, derived from the rows the way sieveModel.ts deriveSieve derives them:
 *  a row whose source is off is HELD; one with a score is SCORED; one a gate named and did
 *  not score is GATED; the rest wait for the matcher. */
function factsOf(rows: JobseekerPostingSummary[], sources: JobseekerSource[]) {
  const on = new Set(sources.filter((s) => s.enabled && !s.pausedReason).map((s) => s.id));
  const live = rows.filter((r) => on.has(r.sourceId));
  const scored = live.filter((r) => r.matchTotal !== null).sort(byScore);
  const open = scored.filter((r) => r.status === "new" || r.status === "shortlisted");
  // The top five are the open rows whose ad states its skills (deriveSieve `top5`). A target
  // row scoring ABOVE the fifth of them must be among the five cards, twins folded or not.
  const ranked = open.filter((r) => r.skillsStated !== false);
  const fifth = ranked.length >= 5 ? (ranked[4]!.matchTotal ?? -1) : null;
  return {
    held: rows.filter((r) => !on.has(r.sourceId)),
    scored,
    gated: live.filter((r) => r.matchTotal === null && r.blockedBy.length > 0),
    waiting: live.filter((r) => r.matchTotal === null && r.blockedBy.length === 0),
    target: rows.filter(isTarget),
    openTargets: open.filter(isTarget),
    targetInTopFive: ranked.some((r) => isTarget(r) && (fifth === null || (r.matchTotal ?? -1) > fifth)),
  };
}

/** A Want card, edited the way a seeker edits it: open the view, work the draft, Done. */
async function editCard(heading: RegExp, fill: (card: Locator) => Promise<void>): Promise<void> {
  const card = ui.wantCard(page, heading);
  await ui.wantView(card).click();
  const done = card.getByRole("button", { name: /^done$/i });
  await expect(done).toBeVisible();
  await fill(card);
  await done.click();
  // The view is back only when Done accepted the draft; a refusal keeps the editor open.
  await expect(ui.wantView(card)).toBeVisible();
}

async function viewSays(card: Locator): Promise<string> {
  const view = ui.wantView(card);
  return `${(await view.getAttribute("aria-label")) ?? ""} ${await view.innerText()}`;
}

function planBoard(spec: string, catalog: CatalogEntryView[]): BoardPlan | string {
  const at = spec.indexOf(":");
  const vendor = (at > 0 ? spec.slice(0, at) : "").trim().toLowerCase();
  const company = (at > 0 ? spec.slice(at + 1) : "").trim();
  if (!vendor || !company) return `${spec}: expected <vendor>:<company>`;
  const key = ATS_KEY[vendor];
  if (!key) return `${spec}: no ATS vendor "${vendor}" (one of ${Object.keys(ATS_KEY).join(", ")})`;
  const entry = catalog.find((e) => e.adapter === `ats_${vendor}` && e.needsCompanyConfig);
  if (!entry) return `${spec}: the sources catalog has no per-company ${vendor} entry`;
  return { spec, vendor, slug: company, key, entry };
}

function companyOf(s: JobseekerSource): string | null {
  const key = s.adapter.startsWith("ats_") ? ATS_KEY[s.adapter.slice(4)] : undefined;
  const v = (key ? s.config[key] : undefined) ?? s.config.slug;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function sourceName(s: JobseekerSource | undefined, fallback: string): string {
  if (!s) return fallback;
  const company = companyOf(s);
  return `${s.adapter} · ${s.host}${company ? ` · ${company}` : ""}`;
}

/**
 * The Sources step's "available to add" form for one ATS vendor: type the company, Add. The
 * form posts the source and switches it on itself; the answer to its POST says which.
 */
async function addBoardInUi(sources: Locator, plan: BoardPlan): Promise<{ id: string } | { refused: string }> {
  const field = new RegExp(escapeRe(plan.entry.label), "i");
  // `has` is matched INSIDE each form, so the inner locator is rooted at the page, not at
  // the section.
  const form = sources.locator("form").filter({ has: page.getByRole("textbox", { name: field }) }).first();
  if ((await form.count()) === 0) return { refused: "the Sources step shows no company form for this vendor" };
  const posted = page.waitForResponse((r) => r.request().method() === "POST" && pathnameOf(r.url()) === "/api/jobseeker/sources").catch(() => null);
  const switched = page.waitForResponse((r) => r.request().method() === "PATCH" && pathnameOf(r.url()).startsWith("/api/jobseeker/sources/")).catch(() => null);
  await form.getByRole("textbox").fill(plan.slug);
  await form.getByRole("button").click();
  const res = await posted;
  if (!res) return { refused: "the form sent no POST /api/jobseeker/sources" };
  const body = (await res.json().catch(() => null)) as { source?: JobseekerSource; code?: string; field?: string } | null;
  if (res.status() !== 201 || !body?.source) return { refused: `POST /api/jobseeker/sources answered ${res.status()}${body?.code ? ` ${body.code}` : ""}${body?.field ? ` (field ${body.field})` : ""}` };
  // The form switches its new source on itself (StepSources addCompany); wait for that too.
  await switched;
  return { id: body.source.id };
}

// ── the walk ────────────────────────────────────────────────────────────────────────────

test.describe("/me live: the operator's own CV through a real scan", () => {
  test.skip(!CV_PATH, "live-only: set KP_ME_LIVE_CV to a CV file and run it through scripts/e2e/me-live.mjs");
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ browser }) => {
    fs.mkdirSync(OUT, { recursive: true });
    api = await request.newContext({ baseURL: E2E_BASE_URL, timeout: 2 * MIN });
    context = await browser.newContext({ baseURL: E2E_BASE_URL, viewport: { width: 1440, height: 900 }, locale: "en-US" });
    bound(context);
    // English accessible names: every name below is matched against messages/en.json.
    await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: E2E_BASE_URL }]);
    page = await context.newPage();
    watch(page);
    await seedDevAuth(page);
  });

  test.afterEach(async () => {
    const info = test.info();
    if (info.status !== info.expectedStatus && page) await page.screenshot({ path: path.join(OUT, `failed-${run.step}.png`), fullPage: true }).catch(() => undefined);
  });

  test.afterAll(async () => {
    test.setTimeout(5 * MIN);
    run.step = "report";
    try {
      note(`report: ${path.relative(process.cwd(), await writeReport())}`);
    } catch (error) {
      note(`the report could not be written: ${firstLine(error)}`);
    }
    await context?.close();
    await api?.dispose();
  });

  test("a · arrive: a fresh /me takes the CV and reads it into a profile", async () => {
    run.step = "a";
    test.setTimeout(10 * MIN);
    const file = path.resolve(CV_PATH);
    expect(fs.existsSync(file) && fs.statSync(file).isFile(), "KP_ME_LIVE_CV must name a readable file").toBe(true);
    // A boolean, never the profile itself: a failed expect prints what it was handed.
    expect((await profileOf()) === null, "a FRESH database: this spec creates the seeker, so it refuses a server that already has one — run it through scripts/e2e/me-live.mjs").toBe(true);

    await gotoMe(page, "/me");
    await expect(ui.step(page, "arrive")).toBeVisible();
    await expect(ui.cvFile(page)).toHaveCount(1);
    await ui.cvFile(page).setInputFiles(file);
    await ui.step(page, "arrive").getByRole("button", { name: /read my cv/i }).click();

    // The read is three hops and may call a model: poll for the profile, and stop early on
    // the step's own failure notice (a localized sentence, never the CV's content).
    const t0 = Date.now();
    let spoke = t0;
    let profile: JobseekerProfile | null = null;
    while (!profile) {
      profile = await profileOf();
      if (profile) break;
      const alert = ui.step(page, "arrive").getByRole("alert");
      if (await alert.count()) throw new Error(`the CV read stopped: ${(await alert.first().innerText()).replace(/\s+/g, " ").slice(0, 200)}`);
      if (Date.now() - t0 > READ_TIMEOUT) throw new Error(`no profile ${READ_TIMEOUT / MIN} minutes after "Read my CV"`);
      if (Date.now() - spoke > 30_000) {
        spoke = Date.now();
        note(`reading the CV… ${clock(spoke - t0)}`);
      }
      await sleep(2_000);
    }
    note(`profile in after ${clock(Date.now() - t0)}`);

    const cvs = await api.get("/api/jobseeker/cvs");
    const listed = cvs.ok() ? (((await cvs.json()) as { cvs?: JobseekerCvListItem[] }).cvs ?? []) : [];
    run.cv = {
      skills: (profile.profile.skillClaims ?? []).length,
      evidence: (profile.profile.evidence ?? []).length,
      languages: (profile.profile.languages ?? []).length,
      reader: listed.find((c) => c.active)?.draftSource ?? "not said",
    };

    // The name is compared, never printed: both sides are what the app read.
    const name = (profile.profile.displayName ?? "").replace(/\s+/g, " ").trim();
    for (const word of new Set([name, ...name.split(" ")])) if (word.length >= 3) privateWords.push(wordRe(word, "gi"));
    await check("the CV read found a name (profile.displayName)", async () => expect(name.length, "displayName is empty").toBeGreaterThan(0));
    if (name) {
      await check("the CV step shows the name GET /api/jobseeker/profile returned", () =>
        expect.poll(async () => (await ui.step(page, "cv").innerText()).replace(/\s+/g, " ").includes(name), { timeout: 30_000 }).toBe(true)
      );
    }
    await check("the CV step opened on the read CV", () => expect(ui.stepTitle(page, "cv")).toBeVisible());
  });

  test("b · your CV: the designed view cycles every layout and hands over a PDF", async () => {
    run.step = "b";
    test.setTimeout(10 * MIN);
    const cv = ui.step(page, "cv");
    await cv.scrollIntoViewIfNeeded();
    const designed = cv.getByRole("button", { name: /designed/i }).first();
    const opened = await check("the CV step switches to the designed view", async () => {
      await expect(designed).toBeVisible();
      // Held disabled while the CV's phrases fly into the portrait; click() waits it out.
      await designed.click();
    });
    if (!opened) return;

    const picker = ui.layoutPicker(cv);
    const layouts = picker.locator("button[aria-pressed]");
    if (!(await check("the designer shows its layout picker", () => expect(layouts.first()).toBeVisible()))) return;
    // Read at runtime: the set of layouts is the designer's to change.
    run.layouts = (await layouts.allInnerTexts()).map((s) => s.trim()).filter(Boolean);
    note(`layouts offered: ${run.layouts.join(", ")}`);
    // The layout a fresh seeker's designer opens on is the default, and the PDF worth
    // proving is that one — not whichever the cycle below happens to end on.
    const pressedAtOpen = await layouts.evaluateAll((els) => els.findIndex((el) => el.getAttribute("aria-pressed") === "true"));
    for (let i = 0; i < run.layouts.length; i++) {
      const button = layouts.nth(i);
      await check(`layout "${run.layouts[i]}" takes`, async () => {
        await button.click();
        await expect(button).toHaveAttribute("aria-pressed", "true");
      });
      await settle(page);
      await shot(ui.designedSheet(cv), `designer/cv-${slug(run.layouts[i]!)}.png`);
    }
    if (pressedAtOpen >= 0 && pressedAtOpen < run.layouts.length - 1) {
      const back = layouts.nth(pressedAtOpen);
      await check(`the layout it opened on ("${run.layouts[pressedAtOpen]}") takes again`, async () => {
        await back.click();
        await expect(back).toHaveAttribute("aria-pressed", "true");
      });
      await settle(page);
    }

    const pressed = slug((await picker.locator('button[aria-pressed="true"]').first().innerText().catch(() => "layout")).trim());
    const download = cv.getByRole("button", { name: /^download pdf$/i });
    if (!(await check("the designer offers Download PDF", () => expect(download).toBeVisible()))) return;
    const downloaded = page.waitForEvent("download", { timeout: PDF_TIMEOUT }).catch(() => null);
    const answered = page.waitForResponse((r) => pathnameOf(r.url()) === "/api/jobseeker/cv.pdf", { timeout: PDF_TIMEOUT }).catch(() => null);
    if (!(await check("Download PDF can be pressed", () => download.click()))) return;
    const res = await answered;
    if (!res) {
      await check("GET /api/jobseeker/cv.pdf answered", async () => {
        throw new Error(`no answer within ${PDF_TIMEOUT / MIN} minutes`);
      });
      return;
    }
    if (res.status() === 200) {
      const file = path.join(OUT, `cv-${pressed}.pdf`);
      await check(`the PDF downloads (${pressed})`, async () => {
        const got = await downloaded;
        expect(got, "no download event after a 200").not.toBeNull();
        await got!.saveAs(file);
        expect(fs.readFileSync(file).subarray(0, 5).toString("latin1")).toBe("%PDF-");
      });
      run.pdf = path.relative(OUT, file);
      // A variable web font embeds as Type 3 and splits a word at every diacritic when an
      // applicant-tracking parser reads it back; the sheet's own static faces embed as
      // TrueType (Type0/CIDFontType2). Chromium writes font dictionaries uncompressed, so
      // the bytes say which.
      if (fs.existsSync(file)) {
        const bytes = fs.readFileSync(file).toString("latin1");
        const subtypes = [...bytes.matchAll(/\/Type\s*\/Font\b[^>]*?\/Subtype\s*\/(\w+)|\/Subtype\s*\/(\w+)[^>]*?\/Type\s*\/Font\b/g)].map((m) => m[1] ?? m[2]!);
        const faces = [...new Set([...bytes.matchAll(/\/BaseFont\s*\/(?:[A-Z]{6}\+)?([^\s/>\]]+)/g)].map((m) => m[1]!))];
        note(`the PDF's fonts: ${subtypes.length} dictionaries (${[...new Set(subtypes)].join(", ")}) · ${faces.join(", ")}`);
        await check("the PDF embeds its text in TrueType fonts, none of them Type 3", async () => {
          expect(subtypes.length, "no font dictionary is visible in the PDF's bytes").toBeGreaterThan(0);
          expect(subtypes.filter((s) => s === "Type3"), "Type 3 fonts in the PDF").toEqual([]);
        });
      }
    } else if (res.status() === 503) {
      // No browser on the server (JOBSEEKER_PDF_UNAVAILABLE): the designer must offer the
      // print path instead, which carries the same layout.
      tolerate("GET /api/jobseeker/cv.pdf answered 503 (no browser on the server); the print fallback was checked", /^\/api\/jobseeker\/cv\.pdf$/, 503);
      run.pdf = "503: no browser on the server, the print fallback was offered";
      await check("the designer offers 'print it instead' when the server cannot make the PDF", () => expect(cv.getByRole("link", { name: /print it instead/i })).toBeVisible());
    } else {
      const body = (await res.json().catch(() => null)) as { code?: string } | null;
      run.pdf = `failed: ${res.status()} ${body?.code ?? ""}`.trim();
      await check("GET /api/jobseeker/cv.pdf makes the PDF (200) or says it cannot (503)", async () => {
        throw new Error(`it answered ${res.status()}${body?.code ? ` ${body.code}` : ""}`);
      });
    }
  });

  test("c · what you want: places, titles and work modes save through the cards", async () => {
    run.step = "c";
    test.setTimeout(8 * MIN);
    await ui.step(page, "want").scrollIntoViewIfNeeded();
    const cards: {
      name: string;
      heading: RegExp;
      fill(card: Locator): Promise<void>;
      says: RegExp[];
      unsaved(p: JobseekerPreferences | undefined): string[];
      patch(p: JobseekerPreferences | undefined): Partial<JobseekerPreferences>;
    }[] = [
      {
        name: "Places",
        heading: /places/i,
        fill: async (card) => {
          const city = card.getByRole("textbox", { name: /city/i });
          await city.fill(CITY);
          await city.press("Enter");
          const country = card.getByRole("textbox", { name: /country/i });
          for (const code of COUNTRIES) {
            await country.fill(code);
            await country.press("Enter");
          }
        },
        // The view states country codes in capitals: matched as whole words, exactly.
        says: [wordRe(CITY, "i"), ...COUNTRIES.map((c) => wordRe(c.toUpperCase()))],
        unsaved: (p) => [...missing(p?.locations, [CITY]), ...missing(p?.countries, COUNTRIES)],
        patch: (p) => ({ locations: union(p?.locations, [CITY]), countries: union(p?.countries, COUNTRIES) }),
      },
      {
        name: "Titles",
        heading: /titles/i,
        fill: async (card) => {
          const field = card.getByRole("textbox", { name: /title/i });
          for (const title of TITLES) {
            await field.fill(title);
            await field.press("Enter");
          }
        },
        says: TITLES.map((t) => wordRe(t, "i")),
        unsaved: (p) => missing(p?.targetTitles, TITLES),
        patch: (p) => ({ targetTitles: union(p?.targetTitles, TITLES) }),
      },
      {
        name: "Work mode",
        heading: /work mode/i,
        fill: async (card) => {
          for (const mode of [/^remote/i, /^hybrid/i]) {
            const button = card.getByRole("button", { name: mode });
            if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
            await expect(button).toHaveAttribute("aria-pressed", "true");
          }
        },
        says: [/remote/i, /hybrid/i],
        unsaved: (p) => missing(p?.workModes, ["remote", "hybrid"]),
        patch: (p) => ({ workModes: [...new Set([...(p?.workModes ?? []), "remote" as const, "hybrid" as const])] }),
      },
    ];

    for (const c of cards) {
      const card = ui.wantCard(page, c.heading);
      await check(`${c.name}: the card opens, takes the draft and closes on Done`, () => editCard(c.heading, c.fill));
      await check(`${c.name}: the card's view states it`, () =>
        expect.poll(async () => { const text = await viewSays(card); return c.says.filter((re) => !re.test(text)).map(String); }, { timeout: 15_000 }).toEqual([])
      );
      const stored = await check(`${c.name}: GET /api/jobseeker/profile holds it`, () =>
        expect.poll(async () => c.unsaved((await profileOf())?.preferences), { timeout: 30_000 }).toEqual([])
      );
      if (!stored) {
        // The scan is only as good as these wants: the API stands in so the walk still means
        // something, and the failed check above is what the run reports.
        try {
          await putPreferences(c.patch((await profileOf())?.preferences));
          note(`${c.name}: written through PUT /api/jobseeker/profile instead`);
        } catch (error) {
          // Already a failed check; the scan will simply search without this want.
          note(`${c.name}: the API could not write it either — ${firstLine(error)}`);
        }
      }
    }
  });

  test("d · sources: the open feeds and the AI companies' own boards switch on", async () => {
    run.step = "d";
    test.setTimeout(10 * MIN);
    // A fresh load: the cards read the countries the Want step just stored (EURES searches them).
    await gotoMe(page, "/me");
    const sources = ui.step(page, "sources");
    await sources.scrollIntoViewIfNeeded();
    const { catalog } = await sourcesOf();

    for (const feed of FEEDS) {
      const sw = sources.getByRole("switch", { name: feed.name }).first();
      const on = await check(`${feed.label}: switched on in the Sources step`, async () => {
        if ((await sw.getAttribute("aria-checked")) !== "true") await sw.click();
        await expect(sw).toHaveAttribute("aria-checked", "true", { timeout: 90_000 });
      });
      if (!on) {
        const made = await createSource(feed.label, feed.catalogId, null, (s) => s.adapter === feed.adapter);
        if (made) await enableSource(feed.label, made);
      }
    }

    // The companies' own boards: the step's "available to add" form first, the API when the
    // form cannot. A board that cannot be added at all (a wrong slug, a board that moved) is
    // recorded under "Sources that failed", never fatal.
    const refusals = new Map<string, string[]>();
    const added: { plan: BoardPlan; sourceId: string; via: "the Sources form" | "the API" }[] = [];
    for (const spec of BOARDS) {
      const plan = planBoard(spec, catalog);
      if (typeof plan === "string") {
        run.sourceFailures.push(`board ${plan}`);
        continue;
      }
      const inUi = await addBoardInUi(sources, plan).catch((error: unknown) => ({ refused: firstLine(error) }));
      if ("id" in inUi) {
        added.push({ plan, sourceId: inUi.id, via: "the Sources form" });
        note(`${spec}: added through the Sources form`);
        continue;
      }
      refusals.set(inUi.refused, [...(refusals.get(inUi.refused) ?? []), spec]);
      // `slug` rides beside the vendor's own key: it is what the form sends, and what the UI
      // names a company source by (sourcesApi.ts sourceDisplayLabel).
      const made = await createSource(`board ${spec}`, plan.entry.id, { [plan.key]: plan.slug, slug: plan.slug }, (s) => s.adapter === plan.entry.adapter && companyOf(s) === plan.slug);
      if (made) {
        added.push({ plan, sourceId: made.id, via: "the API" });
        note(`${spec}: the form could not (${inUi.refused}); created through the API`);
      }
    }
    run.boards = added.map((a) => ({ spec: a.plan.spec, sourceId: a.sourceId, via: a.via }));
    const configDefect =
      "The form posts config {slug}, but each ATS adapter reads its own key (greenhouse token, lever site, ashby board, workable subdomain: adapters/registry.ts hostForAdapter), so the create is refused before anything is fetched.";
    for (const [why, specs] of refusals) {
      run.findings.push(`The Sources step's company form could not add ${specs.join(", ")}: ${why}.${/JOBSEEKER_RULES_INVALID/.test(why) ? ` ${configDefect}` : ""} The API created them instead (any it refused too are under "Sources that failed").`);
      const status = Number(/answered (\d{3})/.exec(why)?.[1]);
      if (status) tolerate(`the Sources step's company form was refused with ${status} (recorded under Findings)`, /^\/api\/jobseeker\/sources$/, status);
    }

    // Boards the API created are news to the page: load it again and switch each on where
    // the owner would, on its own card; the API only when the card cannot.
    if (added.some((a) => a.via === "the API")) await gotoMe(page, "/me");
    for (const { plan, sourceId, via } of added) {
      if (via !== "the API") continue;
      const sw = sources.getByRole("switch", { name: new RegExp(`${escapeRe(plan.entry.label)}.*${escapeRe(plan.slug)}`, "i") }).first();
      const on = await check(`${plan.spec}: switched on on its own card`, async () => {
        if ((await sw.getAttribute("aria-checked")) !== "true") await sw.click();
        await expect(sw).toHaveAttribute("aria-checked", "true", { timeout: 60_000 });
      });
      if (!on) {
        const source = (await sourcesOf()).sources.find((s) => s.id === sourceId);
        if (source) await enableSource(`board ${plan.spec}`, source);
      }
    }

    const { sources: list } = await sourcesOf();
    const isOn = (s: JobseekerSource | undefined) => !!s && s.enabled && !s.pausedReason;
    for (const feed of FEEDS) {
      await check(`${feed.label} feeds the sieve (GET /api/jobseeker/sources)`, async () => expect(isOn(list.find((s) => s.adapter === feed.adapter))).toBe(true));
    }
    await check("every company board that was added feeds the sieve", async () =>
      expect(added.filter((a) => !isOn(list.find((s) => s.id === a.sourceId))).map((a) => a.plan.spec)).toEqual([])
    );
    await check("no tier B or C source is on, and no board's terms were acknowledged", async () =>
      expect(list.filter((s) => (s.tier !== "A" && s.enabled) || s.acknowledgedAt !== null).map((s) => `${s.host} (tier ${s.tier})`)).toEqual([])
    );
    note(`on: ${list.filter(isOn).map((s) => sourceName(s, s.id)).join(" | ")}`);
  });

  test("e · scan: a real scan runs to the end", async () => {
    run.step = "e";
    test.setTimeout(SCAN_BUDGET + 10 * MIN);
    const tRun = Date.now();
    const sieve = ui.step(page, "sieve");
    await sieve.scrollIntoViewIfNeeded();
    // The flow's scan door lives in the sieve; the Want step may show the same door too.
    const inSieve = sieve.getByRole("button", { name: /scan now/i });
    const door = (await inSieve.count()) ? inSieve.first() : page.getByRole("button", { name: /scan now/i }).first();
    const started = { taskId: null as string | null };
    await check("Scan now starts a scan (POST /api/jobseeker/scan answers 202)", async () => {
      await expect(door).toBeVisible({ timeout: 30_000 });
      const posted = page.waitForResponse((r) => r.request().method() === "POST" && pathnameOf(r.url()) === "/api/jobseeker/scan");
      await door.click();
      const res = await posted;
      started.taskId = ((await res.json().catch(() => null)) as { taskId?: string } | null)?.taskId ?? null;
      expect(res.status()).toBe(202);
    });
    if (!started.taskId) {
      const res = await api.post("/api/jobseeker/scan");
      started.taskId = ((await res.json().catch(() => null)) as { taskId?: string } | null)?.taskId ?? null;
      note("the scan was started through the API instead");
    }
    const taskId = started.taskId;
    expect(taskId, "a scan task started").toBeTruthy();

    // Follow it where the task tray does (GET /api/tasks), a line per change, a heartbeat
    // every two minutes when nothing moves.
    const t0 = Date.now();
    let done: Task | null = null;
    let last = "";
    let spoke = 0;
    let pictured = false;
    while (!done && Date.now() - t0 < SCAN_TIMEOUT) {
      const res = await api.get("/api/tasks").catch(() => null);
      const tasks = res?.ok() ? (((await res.json()) as { tasks?: Task[] }).tasks ?? []) : [];
      const mine = tasks.find((t) => t.id === taskId) ?? tasks.filter((t) => t.kind === "jobseeker_scan").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (mine) {
        const line = `${mine.status} ${mine.progressDone}/${mine.progressTotal}${mine.progressMsg ? ` · ${mine.progressMsg}` : ""}`;
        if (line !== last || Date.now() - spoke > 2 * MIN) {
          note(`scan +${clock(Date.now() - t0)} ${line === last ? `still ${line}` : line}`);
          last = line;
          spoke = Date.now();
        }
        if (mine.status !== "queued" && mine.status !== "running") done = mine;
      }
      if (!pictured && Date.now() - t0 > 20_000) {
        pictured = true;
        await shot(sieve, "scan/running.png");
      }
      if (!done) await sleep(10_000);
    }
    if (!done) {
      // Leave no scan behind on a server this spec does not own the lifetime of.
      await api.delete(`/api/tasks/${encodeURIComponent(taskId!)}`).catch(() => null);
      throw new Error(`the scan did not finish within ${SCAN_TIMEOUT / MIN} minutes (last: ${last || "never seen in GET /api/tasks"}); it was cancelled`);
    }

    const full = await api.get(`/api/tasks/${encodeURIComponent(taskId!)}`);
    const record = full.ok() ? (((await full.json()) as { task?: Task }).task ?? null) : null;
    const result = record?.result as ScanSummary | null | undefined;
    const summary = result && Array.isArray(result.sources) ? result : null;
    run.scan = { taskId: taskId!, status: done.status, error: done.error, seconds: Math.round((Date.now() - t0) / 1000), summary };
    note(`scan ${done.status} in ${clock(Date.now() - t0)}${summary ? ` · matched ${summary.matched} · gated ${summary.koFiltered} · deep-dived ${summary.deepDived}` : ""}`);

    // One board with a wrong slug must not sink the run: per-source outcomes are recorded.
    if (summary) {
      const { sources } = await sourcesOf();
      for (const s of summary.sources) {
        if (s.outcome !== "succeeded") run.sourceFailures.push(`${sourceName(sources.find((x) => x.id === s.sourceId), s.sourceId)}: the scan ${s.outcome}${s.reason ? ` (${s.reason})` : ""}`);
      }
    }
    await check("the scan task succeeded", async () => expect(done!.status, done!.error ?? "").toBe("succeeded"));
    await check("no scan phase failed outright (every structure or match batch)", async () =>
      expect((summary?.failures ?? []).filter((f) => f.phase !== "deepdive" && f.chunks >= f.of).map((f) => `${f.phase} ${f.code}`)).toEqual([])
    );

    // Scan again while postings still wait for a score: the scan resumes where its wall
    // budget stopped it, so the boards the first pass could not structure get their turn.
    for (let pass = 2; pass <= SCAN_PASSES && Date.now() - tRun < SCAN_BUDGET; pass++) {
      const rows = await allPostings(false).catch(() => null);
      const waiting = rows ? rows.filter((r) => r.matchTotal === null && r.blockedBy.length === 0).length : 0;
      if (!rows || waiting === 0) break;
      note(`${waiting} postings still wait for a score: scan pass ${pass}`);
      const res = await api.post("/api/jobseeker/scan");
      const id = ((await res.json().catch(() => null)) as { taskId?: string } | null)?.taskId ?? null;
      if (!id) {
        run.findings.push(`Scan pass ${pass} did not start (HTTP ${res.status()}).`);
        break;
      }
      const t1 = Date.now();
      let ended: Task | null = null;
      while (!ended && Date.now() - t1 < SCAN_TIMEOUT && Date.now() - tRun < SCAN_BUDGET) {
        await sleep(10_000);
        const r = await api.get("/api/tasks").catch(() => null);
        const tasks = r?.ok() ? (((await r.json()) as { tasks?: Task[] }).tasks ?? []) : [];
        const mine = tasks.find((t) => t.id === id);
        if (mine && mine.status !== "queued" && mine.status !== "running") ended = mine;
      }
      const full = ended ? await api.get(`/api/tasks/${encodeURIComponent(id)}`).catch(() => null) : null;
      const rec = full?.ok() ? (((await full.json()) as { task?: Task }).task ?? null) : null;
      const sum = rec?.result as ScanSummary | null | undefined;
      run.scanPasses.push({ pass, waitingBefore: waiting, status: ended?.status ?? "still running", seconds: Math.round((Date.now() - t1) / 1000), matched: sum && typeof sum.matched === "number" ? sum.matched : null });
      note(`scan pass ${pass} ${ended?.status ?? "did not end in time"} in ${clock(Date.now() - t1)}${sum ? ` · matched ${sum.matched}` : ""}`);
      if (!ended) break;
    }
  });

  test("f · results: AI-engineering postings are ranked, openable and decidable", async () => {
    run.step = "f";
    test.setTimeout(20 * MIN);
    const read = { rows: [] as JobseekerPostingSummary[], sources: [] as JobseekerSource[] };
    await check("GET /api/jobseeker/postings?status=all pages to the end", async () => {
      read.sources = (await sourcesOf()).sources;
      read.rows = await allPostings();
    });
    const { rows, sources } = read;
    run.sources = sources;
    run.postings = rows;
    const facts = factsOf(rows, sources);
    note(`found ${rows.length} · scored ${facts.scored.length} · gated ${facts.gated.length} · waiting ${facts.waiting.length} · held ${facts.held.length} · target ${facts.target.length}`);
    await check("the scan found postings", async () => expect(rows.length).toBeGreaterThan(0));
    await check("at least one posting matches a stated target title (targetAlignment.state = target)", async () => expect(facts.target.length).toBeGreaterThan(0));
    const reachable = await check("a posting matching a target title reached the ranking (scored and open)", async () => expect(facts.openTargets.length).toBeGreaterThan(0));

    run.loadedResults = await check("the flow loads the results", () => gotoMe(page, "/me"));
    if (!run.loadedResults) return;
    const evening = ui.step(page, "evening");
    // The sieve's heading counts every row it drew; a simple ICU argument is not grouped,
    // a plural one is — either form is the same number.
    const counts = [String(rows.length), new Intl.NumberFormat("en").format(rows.length)];
    await check("the Sieve states the number of postings the API holds", () =>
      expect.poll(async () => { const text = await ui.stepTitle(page, "sieve").innerText(); return counts.some((n) => wordRe(n).test(text)); }, { timeout: 30_000 }).toBe(true)
    );
    await check("the Evening ranks the scored postings in cards", () => expect(ui.topCards(evening).first()).toBeVisible());
    await check("the Evening states how many it shows", () => expect(evening.getByText(/showing\s+[\d,]+\s+of\s+[\d,]+/i).first()).toBeVisible());
    if (reachable) {
      if (facts.targetInTopFive) {
        await check("a top card carries the 'matches your target' marker", () => expect(ui.topCards(evening).filter({ hasText: /matches your target/i }).first()).toBeVisible());
      } else {
        run.findings.push(`No posting matching a target title scored into the top five (the best one is #${facts.scored.indexOf(facts.openTargets[0]!) + 1} of ${facts.scored.length} scored), so the marker was checked in the ranking below them instead.`);
        await check("the ranking marks the target matches ('matches your target')", () => expect(evening.getByRole("button", { name: /matches your target/i }).first()).toBeVisible());
      }

      // Open the best target match where the seeker would: on the Evening.
      const best = facts.openTargets[0]!;
      let card = evening.getByRole("button", { name: best.title });
      if (best.company) card = card.filter({ hasText: best.company });
      const detail = page
        .waitForResponse((r) => r.request().method() === "GET" && /^\/api\/jobseeker\/postings\/[^/]+$/.test(pathnameOf(r.url())), { timeout: MIN })
        .catch(() => null);
      let openedId: string | null = null;
      const opened = await check(`the best target match opens on the Weigh step: "${best.title}"${best.company ? ` at ${best.company}` : ""}`, async () => {
        await card.first().click();
        const res = await detail;
        openedId = res ? decodeURIComponent(pathnameOf(res.url()).split("/").pop() ?? "") : null;
        await expect(ui.stepTitle(page, "weigh")).toContainText(best.title);
      });
      if (opened) {
        const id = openedId ?? best.id;
        run.opened = { id, title: best.title, shortlisted: false };
        const weigh = ui.step(page, "weigh");
        const shortlist = weigh.getByRole("button", { name: /shortlist/i }).first();
        const patched = page
          .waitForResponse((r) => r.request().method() === "PATCH" && pathnameOf(r.url()) === `/api/jobseeker/postings/${encodeURIComponent(id)}`, { timeout: MIN })
          .catch(() => null);
        await check("Shortlist on the Weigh step saves the decision", async () => {
          await shortlist.click();
          const res = await patched;
          expect(res?.status() ?? 0, "PATCH /api/jobseeker/postings/[id]").toBe(200);
        });
        run.opened.shortlisted = await check("the shortlist persisted (GET /api/jobseeker/postings/[id])", () =>
          expect
            .poll(async () => {
              const res = await api.get(`/api/jobseeker/postings/${encodeURIComponent(id)}`);
              return res.ok() ? (((await res.json()) as { view?: { status?: string } }).view?.status ?? null) : `HTTP ${res.status()}`;
            }, { timeout: 30_000 })
            .toBe("shortlisted")
        );
        await check("the decide control reads as pressed", () => expect(shortlist).toHaveAttribute("aria-pressed", "true"));
      }
    }
  });

  test("g · visual capture: every section in both themes, on a desktop and on a phone", async ({ browser }) => {
    run.step = "g";
    test.setTimeout(25 * MIN);
    const url = run.opened ? `/me?open=${encodeURIComponent(run.opened.id)}` : "/me";

    // Desktop: the page the results step left open (1440x900, the posting open and decided)
    // is exactly the state worth reviewing, and one load fewer on the rate-limited feed read.
    await check("desktop: every section photographed in both themes", async () => {
      if (!run.loadedResults) await gotoMe(page, url);
      await captureThemes(page, "desktop");
    });

    const phone = await browser.newContext({ baseURL: E2E_BASE_URL, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "en-US", reducedMotion: "reduce" });
    bound(phone);
    try {
      await check("phone: every section photographed in both themes", async () => {
        await phone.addCookies([{ name: "NEXT_LOCALE", value: "en", url: E2E_BASE_URL }]);
        const mobile = await phone.newPage();
        watch(mobile);
        await seedDevAuth(mobile);
        await gotoMe(mobile, url);
        await captureThemes(mobile, "mobile");
      });
    } finally {
      await phone.close();
    }
  });

  test("h · the walk raised no page error and every check held", async () => {
    run.step = "h";
    const problems = [
      ...run.checks.filter((c) => !c.ok).map((c) => `[${c.step}] ${c.label} — ${c.detail}`),
      ...unexplained().map((i) => `[${i.step}] ${i.kind}: ${i.text}${i.url ? ` (${pathnameOf(i.url)})` : ""}`),
    ];
    for (const finding of run.findings) note(`finding: ${finding}`);
    expect(problems, "failed checks, page errors and console errors collected across the walk (test-results/me-live/report.md)").toEqual([]);
  });
});

// ── the pictures and the report ─────────────────────────────────────────────────────────

async function captureThemes(p: Page, viewport: "desktop" | "mobile"): Promise<void> {
  for (const theme of ["light", "dark"] as const) {
    await applyTheme(p, theme);
    const dir = `${theme}-${viewport}`;
    for (const [i, id] of STEPS.entries()) {
      const section = ui.step(p, id);
      if ((await section.count()) === 0) {
        run.checks.push({ step: run.step, label: `section #s-${id} exists (${dir})`, ok: false, detail: "not on the page" });
        continue;
      }
      await shot(section, `${dir}/${String(i + 1).padStart(2, "0")}-${id}.png`);
    }
    await shot(p, `${dir}/full-page.png`);
    note(`captured ${dir}`);
  }
  await applyTheme(p, "light");
}

async function writeReport(): Promise<string> {
  const sources = run.sources ?? (await sourcesOf().catch(() => null))?.sources ?? [];
  const rows = run.postings ?? (await allPostings(false).catch(() => null));
  const facts: Facts | null = rows ? factsOf(rows, sources) : null;
  const named = (id: string) => sourceName(sources.find((s) => s.id === id), id);
  const cell = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : scrub(String(v)).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim());
  const failed = run.checks.filter((c) => !c.ok);
  const errors = unexplained();
  const L: string[] = [];

  L.push("# /me live run", "");
  L.push(`${run.startedAt.toISOString()} → ${new Date().toISOString()} · ${E2E_BASE_URL}`, "");
  L.push(`**${failed.length || errors.length ? "FAILED" : "PASSED"}** — ${run.checks.length - failed.length} checks held, ${failed.length} failed, ${errors.length} page or console errors, ${run.findings.length} findings.`, "");
  L.push(`- Wants typed through the cards: ${[CITY, ...COUNTRIES.map((c) => c.toUpperCase())].join(", ")} · ${TITLES.join(", ")} · remote, hybrid · level and pay left unset`);
  if (run.cv) L.push(`- The CV read (counts only): ${run.cv.skills} skills, ${run.cv.evidence} evidence lines, ${run.cv.languages} languages; drafted by: ${run.cv.reader}`);
  if (run.layouts.length) L.push(`- Designer layouts cycled: ${run.layouts.join(", ")} · PDF: ${run.pdf ?? "not reached"}`);
  if (run.boards.length) L.push(`- Company boards: ${run.boards.map((b) => `${b.spec} (${b.via})`).join(", ")}`);
  if (run.scan) {
    const s = run.scan.summary;
    L.push(`- Scan: task ${run.scan.taskId} ${run.scan.status} in ${clock(run.scan.seconds * 1000)}${run.scan.error ? ` (${run.scan.error})` : ""}${s ? ` · matched ${s.matched}, gated ${s.koFiltered}, deep-dived ${s.deepDived}${s.deepDiveSkipped ? ` (deep-dive skipped: ${s.deepDiveSkipped})` : ""}` : ""}`);
    for (const f of s?.failures ?? []) L.push(`  - phase ${f.phase}: ${f.chunks} of ${f.of} failed (${f.code})`);
  }
  for (const pass of run.scanPasses) {
    L.push(`- Scan pass ${pass.pass}: ${pass.waitingBefore} waiting before it, ${pass.status} in ${clock(pass.seconds * 1000)}${pass.matched !== null ? ` · matched ${pass.matched}` : ""}`);
  }
  if (run.opened) L.push(`- Opened on the Weigh step: ${run.opened.title} — ${run.opened.shortlisted ? "shortlisted, and it persisted" : "the shortlist did not persist"}`);
  L.push("");

  if (rows && facts) {
    L.push("## Postings by source", "");
    L.push("| Source (adapter · host · company) | Scan | Found | Scored | Gated | Waiting | Held | Target |", "|---|---|---:|---:|---:|---:|---:|---:|");
    const ids = [...new Set([...sources.map((s) => s.id), ...rows.map((r) => r.sourceId)])];
    const count = (list: JobseekerPostingSummary[], id: string) => list.filter((r) => r.sourceId === id).length;
    const outcome = (id: string) => run.scan?.summary?.sources.find((s) => s.sourceId === id);
    for (const id of ids.sort((a, b) => count(rows, b) - count(rows, a))) {
      const o = outcome(id);
      if (!o && !count(rows, id) && !sources.find((s) => s.id === id)?.enabled) continue;
      L.push(`| ${cell(named(id))} | ${cell(o ? `${o.outcome}${o.reason ? ` (${o.reason})` : ""}${o.truncated ? ", capped" : ""}` : "")} | ${count(rows, id)} | ${count(facts.scored, id)} | ${count(facts.gated, id)} | ${count(facts.waiting, id)} | ${count(facts.held, id)} | ${count(facts.target, id)} |`);
    }
    L.push(`| **all** | | **${rows.length}** | **${facts.scored.length}** | **${facts.gated.length}** | **${facts.waiting.length}** | **${facts.held.length}** | **${facts.target.length}** |`, "");

    const gates = new Map<string, number>();
    for (const r of facts.gated) for (const g of r.blockedBy) gates.set(g, (gates.get(g) ?? 0) + 1);
    if (gates.size) L.push(`Caught by gates: ${[...gates].sort((a, b) => b[1] - a[1]).map(([g, n]) => `${g} ${n}`).join(", ")} (a posting can fail more than one).`, "");

    L.push("## Target matches", "");
    const byTitle = new Map<string, number>();
    for (const r of facts.target) byTitle.set(r.targetAlignment?.matchedTitle ?? "(title not said)", (byTitle.get(r.targetAlignment?.matchedTitle ?? "(title not said)") ?? 0) + 1);
    L.push(`${facts.target.length} postings match a stated target title — ${facts.openTargets.length} scored and open, ${facts.target.filter((r) => r.matchTotal === null && r.blockedBy.length).length} caught by a gate.`);
    if (byTitle.size) L.push(`By the title they matched: ${[...byTitle].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(", ")}.`);
    L.push("");

    // Repeats folded as the sieve folds them (sieveModel.twinKey: same source, title and
    // employer), so the table reads like the ranking the seeker sees.
    const shown: JobseekerPostingSummary[] = [];
    const repeats = new Map<string, number>();
    const keptFor = new Map<string, string>();
    for (const r of facts.scored) {
      const key = twinKey(r);
      const kept = key ? keptFor.get(key) : undefined;
      if (kept) {
        repeats.set(kept, (repeats.get(kept) ?? 0) + 1);
        continue;
      }
      if (key) keptFor.set(key, r.id);
      if (shown.length < 15) shown.push(r);
    }
    L.push("## Top 15 scored", "", "Repeats of one job (same source, title and employer) are folded, as the sieve folds them.", "");
    L.push("| # | Score | Tier | Direction | Title | Company | Country | Mode | Source |", "|---:|---|---|---|---|---|---|---|---|");
    shown.forEach((r, i) => {
      const a = r.targetAlignment;
      const direction = a ? `${a.state}${a.state === "target" && a.matchedTitle ? `: ${a.matchedTitle}` : a.state === "past" && a.pastFamily ? `: ${a.pastFamily}` : ""}` : "";
      const score = `${r.skillsStated === false ? "— (no skills stated) " : ""}${r.matchTotal}${r.confidence ? ` (${r.confidence.low}–${r.confidence.high})` : ""}`;
      const title = `${r.title}${repeats.get(r.id) ? ` (+${repeats.get(r.id)} more listed)` : ""}`;
      L.push(`| ${i + 1} | ${cell(score)} | ${cell(r.fitTier)} | ${cell(direction)} | ${cell(title)} | ${cell(r.company)} | ${cell(r.country)} | ${cell(r.workMode)} | ${cell(named(r.sourceId))} |`);
    });
    L.push("");
  } else {
    L.push("## Postings", "", "Not read: the walk ended before the results step, and the last-chance read failed.", "");
  }

  L.push("## Sources that failed", "");
  L.push(...(run.sourceFailures.length ? run.sourceFailures.map((f) => `- ${f}`) : ["None."]), "");
  if (run.findings.length) L.push("## Findings", "", ...run.findings.map((f) => `- ${f}`), "");

  L.push("## Checks", "");
  L.push(...run.checks.map((c) => `- ${c.ok ? "✓" : "✗"} [${c.step}] ${c.label}${c.detail ? ` — ${c.detail}` : ""}`), "");

  L.push("## Page and console errors", "");
  L.push(...(errors.length ? errors.map((i) => `- [${i.step}] ${i.kind}: ${cell(i.text)}${i.url ? ` (${pathnameOf(i.url)})` : ""}`) : ["None unexplained."]));
  const excused = run.issues.filter((i) => !errors.includes(i));
  if (excused.length) {
    L.push("", "Explained, not counted:");
    for (const t of tolerances) {
      const n = excused.filter((i) => t.match(i)).length;
      if (n) L.push(`- ${n} × ${t.why}`);
    }
  }
  L.push("");

  L.push("## Screenshots", "", `${run.shots.length} pictures under test-results/me-live/:`);
  const dirs = new Map<string, number>();
  for (const s of run.shots) dirs.set(path.dirname(s), (dirs.get(path.dirname(s)) ?? 0) + 1);
  for (const [dir, n] of dirs) L.push(`- ${dir}/ (${n})`);
  L.push("");

  const file = path.join(OUT, "report.md");
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(file, L.join("\n"));
  return file;
}
