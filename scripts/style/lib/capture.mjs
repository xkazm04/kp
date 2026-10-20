// One surface, one size, one theme -> one full-page PNG, or a loud failure.
//
// Fails (the shot is kept, the run exits 1) on: a console error or uncaught page
// error, a /api request answering >= 400 or failing outright, a document that
// answers >= 400, an html[data-theme] that is not the theme asked for, and an
// EMPTY MOUNT - the target's root absent, under minHeight px tall, or carrying
// fewer than minText characters. A blank screenshot must never look like a result.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const DEFAULTS = { minHeight: 120, minText: 40, settle: 800 };

/**
 * Playwright's pinned headless shell when installed, else the newest
 * chromium_headless_shell already in the ms-playwright cache. Never a system
 * Chrome: it auto-updates between a BEFORE and an AFTER run. The version lands
 * in every report and --pair refuses a mismatch.
 */
export async function launchBrowser() {
  const { chromium } = await import('@playwright/test');
  try {
    return await chromium.launch();
  } catch (err) {
    if (!/Executable doesn't exist/.test(String(err?.message))) throw err;
    const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
    const builds = (existsSync(cache) ? readdirSync(cache) : [])
      .map((d) => /^chromium_headless_shell-(\d+)$/.exec(d)).filter(Boolean)
      .sort((a, b) => Number(b[1]) - Number(a[1]));
    for (const m of builds) {
      const exe = path.join(cache, m[0], 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
      if (existsSync(exe)) return chromium.launch({ executablePath: exe });
    }
    throw err;
  }
}

/** A context already past kp's gates, in the requested theme, with motion reduced. */
export async function openContext(browser, { baseUrl, size, theme, auth = true, init = null }) {
  const context = await browser.newContext({
    viewport: size, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC',
    reducedMotion: 'reduce', colorScheme: theme === 'dark' ? 'dark' : 'light',
  });
  const cookies = [{ name: 'NEXT_LOCALE', value: 'en', url: baseUrl }];
  if (auth) cookies.push({ name: 'kp_entered', value: '1', url: baseUrl });
  await context.addCookies(cookies);
  await context.addInitScript(([t, a]) => {
    try {
      if (a) window.localStorage.setItem('kp_dev_authed', '1');
      window.localStorage.setItem('kp-theme', t);
    } catch { /* storage blocked: the theme check below reports it */ }
  }, [theme, auth]);
  if (init) await context.addInitScript(init);
  return context;
}

/** Attach the failure collectors. Returns the live list. */
export function collectProblems(page, baseUrl) {
  const problems = [];
  const api = `${baseUrl}/api/`;
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 400)}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${String(e?.message ?? e).slice(0, 400)}`));
  page.on('response', (r) => { if (r.url().startsWith(api) && r.status() >= 400) problems.push(`api ${r.status()}: ${r.url().slice(baseUrl.length)}`); });
  page.on('requestfailed', (r) => {
    const why = r.failure()?.errorText ?? '';
    if (r.url().startsWith(api) && !/ERR_ABORTED/.test(why)) problems.push(`api failed (${why}): ${r.url().slice(baseUrl.length)}`);
  });
  return problems;
}

/** Read the root as it stands now. */
export function probeRoot(page, root) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el?.getBoundingClientRect();
    return {
      rootFound: !!el,
      rootHeight: r ? Math.round(r.height) : 0,
      text: el ? (el.innerText || '').replace(/\s+/g, ' ').trim() : '',
      skeletons: el ? [...el.querySelectorAll('.animate-pulse')].filter((s) => s.getBoundingClientRect().height > 0).length : 0,
      dataTheme: document.documentElement.dataset.theme ?? null,
      doc: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    };
  }, root);
}

/**
 * Wait until the root is mounted with content, no skeleton is showing, AND the
 * text has stopped growing for three consecutive reads. Measured 2026-09-25: a
 * "root has >= N chars" test alone passed on the Hiring tab's 88-char header
 * while its 1,100-char body was still streaming in.
 */
export async function waitForContent(page, target, timeout = 25_000) {
  const opts = { root: target.root, minText: target.minText ?? DEFAULTS.minText, minHeight: target.minHeight ?? DEFAULTS.minHeight };
  const deadline = Date.now() + timeout;
  let last = -1, steady = 0, ready = false;
  while (Date.now() < deadline && !ready) {
    const p = await probeRoot(page, opts.root).catch(() => null);
    const len = p?.text.length ?? -1;
    const ok = !!p?.rootFound && len >= opts.minText && p.rootHeight >= opts.minHeight && p.skeletons === 0;
    steady = ok && len === last ? steady + 1 : 0;
    last = len;
    ready = steady >= 3;
    if (!ready) await page.waitForTimeout(400);
  }
  return { ready, ...opts };
}

export async function shootOne(browser, { baseUrl, url, target, theme, size, settle, clock, init }) {
  const context = await openContext(browser, { baseUrl, size, theme, auth: target.auth !== false, init });
  const page = await context.newPage();
  if (clock) await page.clock.setFixedTime(new Date(clock));
  const problems = collectProblems(page, baseUrl);
  let status = 0;
  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    status = res?.status() ?? 0;
  } catch (err) {
    problems.push(`navigation: ${String(err?.message ?? err).split('\n')[0]}`);
  }
  if (status >= 400) problems.push(`document answered ${status}`);
  const content = await waitForContent(page, target);
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(settle ?? DEFAULTS.settle);
  const probe = await probeRoot(page, target.root);
  if (!probe.rootFound) problems.push(`empty mount: root "${target.root}" is absent`);
  else if (probe.rootHeight < content.minHeight) problems.push(`empty mount: root "${target.root}" is ${probe.rootHeight}px tall (< ${content.minHeight})`);
  else if (probe.text.length < content.minText) problems.push(`empty mount: root "${target.root}" has ${probe.text.length} chars (< ${content.minText})`);
  const wantDark = theme === 'dark';
  if ((probe.dataTheme === 'dark') !== wantDark) problems.push(`theme: html[data-theme]=${probe.dataTheme ?? '(unset)'} but ${theme} was asked for`);
  const notes = [];
  if (!content.ready && probe.rootFound) notes.push(probe.skeletons ? `${probe.skeletons} skeleton(s) still pulsing after 25s` : 'content still changing after 25s');
  // CSS animations are frozen by Playwright; JS-driven motion is not, so shoot
  // until two consecutive frames match.
  const snap = () => page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' });
  let png = await snap();
  let stable = false;
  for (let i = 0; i < 6 && !stable; i++) {
    await page.waitForTimeout(350);
    const next = await snap();
    stable = next.equals(png);
    png = next;
  }
  if (!stable) notes.push('still moving after 6 frames (a looping animation?)');
  await context.close();
  return { png, problems: [...new Set(problems)], notes, stable, status, probe: { ...probe, text: undefined, textLength: probe.text.length, textSample: probe.text.slice(0, 160) } };
}
