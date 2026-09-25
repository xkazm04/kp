// The designed CV as a PDF — the print page rendered by a headless Chromium.
//
// A CV is sent as a PDF, and a PDF made any other way loses the design (a Markdown ->
// PDF converter knows nothing of the templates). So the server opens the SAME page the
// seeker previews (/me/cv/print, which renders DesignedCv) in headless Chromium and prints
// it with the stylesheet's own @page size: what the seeker saw is what the file carries,
// text selectable, links live.
//
// The browser is OPTIONAL. `playwright-core` is loaded lazily and only when asked; an
// install without it (a pruned production image) or without a Chromium build answers
// `unavailable`, and the client offers the browser's own print -> Save as PDF, which
// carries the same layout. Degrade, never block.
//
// Safety: the headless page may talk to ONE origin, the app's own loopback — every other
// request is aborted — and it carries only the requester's own cookies, so it can read
// nothing the requester could not. The origin is never taken from the Host header (a
// forged Host would point a server-side browser, cookies attached, at any machine):
// `KP_PDF_ORIGIN` when set, else 127.0.0.1 on the port this server serves.

export type CvPdfOptions = { origin: string; cookieHeader: string | null; path: string; timeoutMs?: number };
export type CvPdfOutcome = { kind: "ok"; bytes: Uint8Array } | { kind: "unavailable"; reason: string } | { kind: "failed"; error: unknown };

type Cookie = { name: string; value: string; url: string };

/** "a=b; c=d" -> cookies bound to `origin`. A malformed pair is dropped, never guessed. */
export function cookiesFor(header: string | null, origin: string): Cookie[] {
  if (!header) return [];
  const out: Cookie[] = [];
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at <= 0) continue;
    const name = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (!name || /[\s,;]/.test(name)) continue;
    out.push({ name, value, url: origin });
  }
  return out;
}

/** The origin the headless browser may load. Never the Host header: `KP_PDF_ORIGIN`
 *  (for a proxy or a container whose port differs), else loopback on this server's port. */
export function pdfOrigin(requestUrl: string, env: Record<string, string | undefined> = process.env): string | null {
  const configured = env.KP_PDF_ORIGIN?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      return null;
    }
  }
  let port = env.PORT?.trim() || "";
  if (!port) {
    try {
      const u = new URL(requestUrl);
      port = u.port || (u.protocol === "https:" ? "443" : "80");
    } catch {
      return null;
    }
  }
  return /^\d{1,5}$/.test(port) ? `http://127.0.0.1:${port}` : null;
}

// Minimal structural types for the slice of playwright-core this uses, so the module
// type-checks whether or not the package is installed.
type PwRoute = { request(): { url(): string }; continue(): Promise<void>; abort(): Promise<void> };
type PwPage = {
  route(pattern: string, handler: (route: PwRoute) => Promise<void>): Promise<void>;
  goto(url: string, opts: { waitUntil: "networkidle"; timeout: number }): Promise<{ status(): number } | null>;
  waitForSelector(selector: string, opts: { timeout: number }): Promise<unknown>;
  evaluate<T>(fn: () => T | Promise<T>): Promise<T>;
  pdf(opts: { preferCSSPageSize: boolean; printBackground: boolean }): Promise<Uint8Array>;
};
type PwContext = { addCookies(cookies: Cookie[]): Promise<void>; newPage(): Promise<PwPage> };
type PwBrowser = { newContext(): Promise<PwContext>; close(): Promise<void> };
export type Launch = () => Promise<PwBrowser>;

async function defaultLaunch(): Promise<PwBrowser> {
  // A variable specifier: the bundler must not follow it (next.config.ts also lists the
  // package in serverExternalPackages), and a missing package is a runtime miss.
  const spec = "playwright-core";
  const mod = (await import(/* webpackIgnore: true */ spec)) as { chromium: { launch(o: { headless: boolean }): Promise<PwBrowser> } };
  return mod.chromium.launch({ headless: true });
}

// One render at a time: a Chromium is ~100 MB of resident memory, and a CV export is a
// human-paced action, so a queue costs nobody anything and bounds the box.
let queue: Promise<unknown> = Promise.resolve();

export function renderCvPdf(opts: CvPdfOptions, launch: Launch = defaultLaunch): Promise<CvPdfOutcome> {
  const run = queue.then(() => renderOnce(opts, launch));
  queue = run.catch(() => undefined);
  return run;
}

async function renderOnce({ origin, cookieHeader, path, timeoutMs = 45_000 }: CvPdfOptions, launch: Launch): Promise<CvPdfOutcome> {
  let browser: PwBrowser;
  try {
    browser = await launch();
  } catch (err) {
    return { kind: "unavailable", reason: err instanceof Error ? err.message.split("\n")[0]! : String(err) };
  }
  try {
    const context = await browser.newContext();
    await context.addCookies(cookiesFor(cookieHeader, origin));
    const page = await context.newPage();
    await page.route("**/*", async (route) => {
      let allowed = false;
      try {
        allowed = new URL(route.request().url()).origin === origin;
      } catch {
        /* an unparsable URL is not the app's own origin: aborted below */
      }
      await (allowed ? route.continue() : route.abort());
    });
    const res = await page.goto(origin + path, { waitUntil: "networkidle", timeout: timeoutMs });
    if (!res || res.status() >= 400) return { kind: "failed", error: new Error(`print page answered ${res?.status() ?? "nothing"}`) };
    await page.waitForSelector(".cvsheet", { timeout: 5_000 });
    await page.evaluate(() => document.fonts.ready.then(() => true));
    const bytes = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    return { kind: "ok", bytes };
  } catch (err) {
    return { kind: "failed", error: err };
  } finally {
    await browser.close().catch(() => {
      /* best-effort: the process is already going away */
    });
  }
}
