// Web vitals per targets.json surface - REPORT-ONLY, not a CI gate.
//
// Skipped unless KP_PERF_VITALS=1. Run it through `npm run perf:vitals`, which
// wraps it in scripts/style/serve.mjs: a throwaway `next start` over a COPY of the
// data (never the operator's server, never a dev server - a dev build's numbers
// measure the compiler, not the app), every surface resolved against that copy,
// KP_E2E_BASE_URL + KP_STYLE_TARGETS handed in. KP_PERF_TARGETS=a,b narrows it.
//
// Per surface: a COLD load in a fresh context (TTFB, FCP, LCP, total long-task ms,
// JS transferred, time-to-content = the target root visible with content and no
// skeleton) and, for a workspace tab, a WARM switch into it from a sibling tab in
// the same nav group (long tasks, JS fetched, time-to-content after the click).
// Writes test-results/perf-vitals/<ts>.json and prints a table.
// docs/design/instruments.md says what it cannot see.
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { NAV_GROUPS } from "../app/features/shell/tabs";

type Target = { path: string; url?: string; root: string; minText?: number; minHeight?: number; tab?: string; auth?: boolean; error?: string };
type Row = { target: string; phase: "cold" | "warm"; ttfbMs: number | null; fcpMs: number | null; lcpMs: number | null; longTaskMs: number; jsKB: number; ttcMs: number | null };

const ENABLED = process.env.KP_PERF_VITALS === "1";
const BASE = process.env.KP_E2E_BASE_URL ?? "http://localhost:3101";
const resolvedFile = process.env.KP_STYLE_TARGETS;
const registry: { server?: unknown; targets: Record<string, Target> } = resolvedFile
  ? JSON.parse(fs.readFileSync(resolvedFile, "utf8"))
  : JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "..", "scripts", "style", "targets.json"), "utf8"));
const only = (process.env.KP_PERF_TARGETS ?? "").split(",").filter(Boolean);
const TARGETS = Object.entries(registry.targets).filter(([name]) => !only.length || only.includes(name));
const rows: Row[] = [];
const tabLabels: Record<string, string> = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "..", "messages", "en.json"), "utf8")).nav.tabs;

/** Observers installed before any page script: LCP, long tasks, and the content watch. */
function instrument({ root, minText, minHeight }: { root: string; minText: number; minHeight: number }) {
  const w = window as unknown as { __kpVitals: { lcp: number | null; longTaskMs: number; contentAt: number | null; since: number } };
  w.__kpVitals = { lcp: null, longTaskMs: 0, contentAt: null, since: 0 };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__kpVitals.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.startTime >= w.__kpVitals.since) w.__kpVitals.longTaskMs += e.duration; }).observe({ type: "longtask", buffered: true });
  const tick = () => {
    const el = document.querySelector(root);
    const ok = el && (el as HTMLElement).innerText.trim().length >= minText && el.getBoundingClientRect().height >= minHeight && !el.querySelector(".animate-pulse");
    if (ok && w.__kpVitals.contentAt === null) w.__kpVitals.contentAt = performance.now();
    if (w.__kpVitals.contentAt === null) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function openPage(browser: import("@playwright/test").Browser, t: Target): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1728, height: 1080 }, locale: "en-US", reducedMotion: "reduce" });
  const cookies = [{ name: "NEXT_LOCALE", value: "en", url: BASE }];
  if (t.auth !== false) cookies.push({ name: "kp_entered", value: "1", url: BASE });
  await context.addCookies(cookies);
  await context.addInitScript(() => { try { localStorage.setItem("kp-theme", "light"); } catch { /* storage blocked: light is the default anyway */ } });
  const page = await context.newPage();
  await page.addInitScript(instrument, { root: t.root, minText: t.minText ?? 40, minHeight: t.minHeight ?? 120 });
  return page;
}

/** Read the vitals collected since `since` (0 = navigation start). */
async function read(page: Page, since: number) {
  return page.evaluate((s) => {
    const v = (window as unknown as { __kpVitals: { lcp: number | null; longTaskMs: number; contentAt: number | null } }).__kpVitals;
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    const js = (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
      .filter((r) => r.startTime >= s && (r.initiatorType === "script" || /\.js(\?|$)/.test(r.name)))
      .reduce((sum, r) => sum + r.transferSize, 0);
    const round = (n: number | null | undefined) => (n == null ? null : Math.round(n));
    return { ttfbMs: s ? null : round(nav?.responseStart), fcpMs: s ? null : round(fcp?.startTime), lcpMs: s ? null : round(v.lcp), longTaskMs: Math.round(v.longTaskMs), jsKB: Math.round(js / 1024), ttcMs: round(v.contentAt === null ? null : v.contentAt - s) };
  }, since);
}

const waitContent = (page: Page) =>
  page.waitForFunction(() => (window as unknown as { __kpVitals: { contentAt: number | null } }).__kpVitals.contentAt !== null, null, { timeout: 45_000 });

test.describe("perf vitals (report-only)", () => {
  test.skip(!ENABLED, "report-only: set KP_PERF_VITALS=1, or run `npm run perf:vitals`");
  test.describe.configure({ mode: "serial" });

  for (const [name, t] of TARGETS) {
    test(`${name}: cold load${t.tab ? " + warm tab switch" : ""}`, async ({ browser }) => {
      test.skip(!!t.error || (!t.url && /\{/.test(t.path)), t.error ?? "placeholder path: run through `npm run perf:vitals` so it is resolved");
      const page = await openPage(browser, t);
      await page.goto(t.url ?? `${BASE}${t.path}`, { waitUntil: "domcontentloaded" });
      await waitContent(page);
      await page.waitForTimeout(1500); // let LCP and trailing long tasks land
      rows.push({ target: name, phase: "cold", ...(await read(page, 0)) });
      await page.context().close();

      if (!t.tab) return;
      const group = NAV_GROUPS.find((g) => g.items.some((i) => i.id === t.tab));
      const from = group?.items.find((i) => i.id !== t.tab);
      const item = group?.items.find((i) => i.id === t.tab);
      if (!from || !item) return;
      const warm = await openPage(browser, t);
      await warm.goto(`${BASE}/?tab=${from.id}`, { waitUntil: "domcontentloaded" });
      await warm.waitForFunction((r) => !!document.querySelector(r), t.root, { timeout: 45_000 });
      await warm.waitForTimeout(2500);
      const label = tabLabels[item.id] ?? item.label;
      const button = warm.getByRole("button", { name: new RegExp(`^${label}\\b`) }).filter({ visible: true }).last();
      await expect(button).toBeVisible();
      const since = await warm.evaluate(() => {
        const v = (window as unknown as { __kpVitals: { contentAt: number | null; longTaskMs: number; since: number } }).__kpVitals;
        v.since = performance.now();
        v.longTaskMs = 0;
        v.contentAt = null;
        const old = document.querySelector("main#main .animate-tab-in");
        const tick = () => {
          const wrap = document.querySelector("main#main .animate-tab-in");
          if (wrap && wrap !== old && (wrap as HTMLElement).innerText.trim().length > 40 && !wrap.querySelector(".animate-pulse")) v.contentAt = performance.now();
          else if (document.querySelector("[role=dialog][aria-modal=true]")) v.contentAt = performance.now();
          if (v.contentAt === null) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        return v.since;
      });
      await button.click();
      await waitContent(warm);
      await warm.waitForTimeout(1000);
      rows.push({ target: name, phase: "warm", ...(await read(warm, since)) });
      await warm.context().close();
    });
  }

  test.afterAll(() => {
    if (!rows.length) return;
    const dir = path.resolve(import.meta.dirname, "..", "test-results", "perf-vitals");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(file, JSON.stringify({ baseUrl: BASE, server: registry.server ?? null, createdAt: new Date().toISOString(), rows }, null, 2));
    const cols = ["target", "phase", "ttfbMs", "fcpMs", "lcpMs", "longTaskMs", "jsKB", "ttcMs"] as const;
    console.log(["", cols.join("\t"), ...rows.map((r) => cols.map((c) => r[c] ?? "-").join("\t")), `\nperf-vitals: ${file}`].join("\n"));
  });
});
