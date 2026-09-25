import { test } from "node:test";
import assert from "node:assert/strict";
import { cookiesFor, pdfOrigin, renderCvPdf, type Launch } from "./cv-pdf";

test("the origin never comes from the Host header", () => {
  // A forged Host lands in request.url; only its PORT is read, the host is loopback.
  assert.equal(pdfOrigin("http://evil.example:3107/api/jobseeker/cv.pdf", {}), "http://127.0.0.1:3107");
  assert.equal(pdfOrigin("https://evil.example/api/jobseeker/cv.pdf", {}), "http://127.0.0.1:443");
  assert.equal(pdfOrigin("http://x/", { PORT: "3000" }), "http://127.0.0.1:3000");
  assert.equal(pdfOrigin("http://x/", { KP_PDF_ORIGIN: "http://app:8080/some/path" }), "http://app:8080");
  assert.equal(pdfOrigin("http://x/", { KP_PDF_ORIGIN: "not a url" }), null);
  assert.equal(pdfOrigin("http://x/", { PORT: "3000; rm" }), null);
});

test("cookies are the requester's own, bound to the render origin, malformed pairs dropped", () => {
  assert.deepEqual(cookiesFor("kp_session=abc.def; theme=dark; =x; bad name=1", "http://127.0.0.1:3000"), [
    { name: "kp_session", value: "abc.def", url: "http://127.0.0.1:3000" },
    { name: "theme", value: "dark", url: "http://127.0.0.1:3000" },
  ]);
  assert.deepEqual(cookiesFor(null, "http://127.0.0.1:3000"), []);
});

test("no browser installed: unavailable, never a throw", async () => {
  const launch: Launch = async () => {
    throw new Error("Cannot find package 'playwright-core'\nstack...");
  };
  const out = await renderCvPdf({ origin: "http://127.0.0.1:1", cookieHeader: null, path: "/me/cv/print" }, launch);
  assert.deepEqual(out, { kind: "unavailable", reason: "Cannot find package 'playwright-core'" });
});

function fakeBrowser(opts: { status?: number; throwAt?: string } = {}) {
  const seen = { aborted: [] as string[], continued: [] as string[], closed: 0, cookies: [] as unknown[], goto: "" };
  let handler: ((r: { request(): { url(): string }; continue(): Promise<void>; abort(): Promise<void> }) => Promise<void>) | null = null;
  const route = (url: string) =>
    handler!({
      request: () => ({ url: () => url }),
      continue: async () => void seen.continued.push(url),
      abort: async () => void seen.aborted.push(url),
    });
  const launch: Launch = async () => ({
    close: async () => void seen.closed++,
    newContext: async () => ({
      addCookies: async (c) => void seen.cookies.push(...c),
      newPage: async () => ({
        route: async (_p, h) => void (handler = h),
        goto: async (url) => {
          seen.goto = url;
          await route(url);
          await route("https://fonts.example/f.woff2");
          await route("http://169.254.169.254/latest/meta-data");
          if (opts.throwAt === "goto") throw new Error("timeout");
          return { status: () => opts.status ?? 200 };
        },
        waitForSelector: async () => true,
        evaluate: async () => true as never,
        pdf: async () => new Uint8Array([37, 80, 68, 70]),
      }),
    }),
  });
  return { launch, seen };
}

test("the headless page reaches only the app's own origin, and the browser always closes", async () => {
  const { launch, seen } = fakeBrowser();
  const out = await renderCvPdf({ origin: "http://127.0.0.1:3107", cookieHeader: "kp_session=s", path: "/me/cv/print?template=compact" }, launch);
  assert.equal(out.kind, "ok");
  assert.equal(seen.goto, "http://127.0.0.1:3107/me/cv/print?template=compact");
  assert.deepEqual(seen.continued, ["http://127.0.0.1:3107/me/cv/print?template=compact"]);
  assert.deepEqual(seen.aborted, ["https://fonts.example/f.woff2", "http://169.254.169.254/latest/meta-data"]);
  assert.equal(seen.closed, 1);
});

test("a failed or refused render is a failure, and still closes the browser", async () => {
  for (const o of [{ status: 404 }, { throwAt: "goto" }]) {
    const { launch, seen } = fakeBrowser(o);
    const out = await renderCvPdf({ origin: "http://127.0.0.1:3107", cookieHeader: null, path: "/me/cv/print" }, launch);
    assert.equal(out.kind, "failed");
    assert.equal(seen.closed, 1);
  }
});
