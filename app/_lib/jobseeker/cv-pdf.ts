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

/** `title`: the PDF's metadata title - the person's name and "CV" (registry
 *  export-format-and-round-trip-verification); Chromium takes it from document.title. */
export type CvPdfOptions = { origin: string; cookieHeader: string | null; path: string; title?: string; timeoutMs?: number };
export type CvPdfOutcome = { kind: "ok"; bytes: Uint8Array } | { kind: "unavailable"; reason: string } | { kind: "failed"; error: unknown };

type Cookie = { name: string; value: string; url: string };

/** The one set of `page.pdf` options, shared with the round trip (scripts/cv/roundtrip.mjs)
 *  so the file it checks is made the way the route makes it: the stylesheet's own A4
 *  `@page`, backgrounds, and a TAGGED PDF - headings, lists and reading order in the
 *  structure tree for a screen reader, at no cost to a layout that is already one flow. */
export const CV_PDF_OPTIONS = { preferCSSPageSize: true, printBackground: true, tagged: true } as const;

/** The download's file name: "Jana-Novakova-CV.pdf" - the person's name and the document
 *  kind (registry export-format-and-round-trip-verification: courtesy and findability in
 *  a recruiter's downloads folder). ASCII-folded, so no upload form and no header encoding
 *  trips on it: diacritics stripped, a few letters that do not decompose spelled out
 *  (ß -> ss, Ł -> L), anything else dropped; words joined by hyphens, case kept. */
export function cvPdfFileName(name: string | null | undefined): string {
  const folded = (name ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ß/g, "ss")
    .replace(/[Łł]/g, (c) => (c === "Ł" ? "L" : "l"))
    .replace(/[Øø]/g, (c) => (c === "Ø" ? "O" : "o"))
    .replace(/[Đđ]/g, (c) => (c === "Đ" ? "D" : "d"))
    .replace(/Æ/g, "AE")
    .replace(/æ/g, "ae")
    .replace(/Œ/g, "OE")
    .replace(/œ/g, "oe")
    .replace(/[Þþ]/g, (c) => (c === "Þ" ? "Th" : "th"));
  const words = folded.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const base = words.join("-").slice(0, 60).replace(/-+$/, "");
  return base ? `${base}-CV.pdf` : "CV.pdf";
}

/** The PDF's metadata title: "Jana Nováková – CV" (the person's name and the document
 *  kind, in their own script - metadata is not a header), or "CV" when there is no name. */
export function cvPdfTitle(name: string | null | undefined): string {
  const person = (name ?? "").replace(/\s+/g, " ").trim();
  return person ? `${person} – CV` : "CV";
}

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
  evaluate<T, A>(fn: (arg: A) => T | Promise<T>, arg: A): Promise<T>;
  pdf(opts: typeof CV_PDF_OPTIONS): Promise<Uint8Array>;
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

async function renderOnce({ origin, cookieHeader, path, title, timeoutMs = 45_000 }: CvPdfOptions, launch: Launch): Promise<CvPdfOutcome> {
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
    // The metadata title is the page's title at print time: the person's, not the app's.
    await page.evaluate((t) => {
      if (t) document.title = t;
      return document.fonts.ready.then(() => true);
    }, title ?? null);
    const bytes = await page.pdf(CV_PDF_OPTIONS);
    return { kind: "ok", bytes };
  } catch (err) {
    return { kind: "failed", error: err };
  } finally {
    await browser.close().catch(() => {
      /* best-effort: the process is already going away */
    });
  }
}
