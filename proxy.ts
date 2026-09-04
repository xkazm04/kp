import { NextResponse, type NextRequest } from "next/server";
import { isLocale, LOCALE_COOKIE } from "./i18n/locales";
import { SESSION_COOKIE, verifySessionEdge } from "./app/_lib/auth/edge-verify";
import { isPublicPath } from "./app/_lib/auth/public-routes";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

// Auth foundation (P2) — the recruiter-surface gate (Next 16 `proxy` convention,
// the renamed successor to `middleware`). FAIL-CLOSED: every path is gated EXCEPT
// an explicit allow-list of public-by-design surfaces (candidate token
// pages/APIs, external webhooks, auth, marketing, health). A forgotten recruiter
// route stays gated (safe); a forgotten public route sends a candidate to /login
// (visible + fixable) — never a PII leak. KP_OPERATOR_PASSWORD set ⇒ enforce
// sessions. UNSET: open passthrough in development (no regression for local dev),
// but FAIL CLOSED in production — a prod deploy that forgot the password must not
// serve the whole recruiter surface to the public; set KP_ALLOW_OPEN=1 to opt back
// into open prod deliberately.
// The allow-list itself lives in `app/_lib/auth/public-routes.ts` — pure and edge-safe,
// so it can be unit-tested (this file sits outside the `app/**/*.test.ts` runner glob).

// A global session-kill epoch (KP_SESSION_EPOCH): bumping it invalidates every
// issued session at once, WITHOUT rotating KP_SECRET (which also encrypts stored
// provider keys). Read inline — the proxy is edge-safe and can't import session.ts
// (node:crypto). Default 0 ⇒ nothing invalidated.
function sessionEpochFromEnv(): number {
  const n = Number.parseInt(process.env.KP_SESSION_EPOCH ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// --- Content-Security-Policy (per-request, nonce'd) ---------------------------
// The policy USED to live in next.config.ts's static headers(), which is why
// `script-src` carried `'unsafe-inline'`: a build-time config cannot mint a
// per-request nonce, and the pre-paint THEME_INIT script in app/layout.tsx has to
// run before first paint. `'unsafe-inline'` in script-src is the one allowance
// that makes a CSP roughly decorative against XSS, so the policy moved HERE,
// where a nonce is cheap.
//
// How the nonce reaches the markup (next/dist/docs/01-app/02-guides/
// content-security-policy.md): Next parses the nonce out of the `Content-Security-
// Policy` header on the *forwarded request* and stamps it onto every script it
// emits — the framework bundles, the RSC payload's inline `self.__next_f.push`
// chunks — and app/layout.tsx reads the same value from the `x-nonce` request
// header for the one inline script this app writes by hand. Nothing needs to be
// nonced by hand anywhere else.
//
// The RESPONSE ships it report-only (see SECURITY_HEADERS' history in
// next.config.ts): a wrongly-enforced policy on /interview/[token] kills a
// candidate's live voice call, so the policy observes before it enforces. It is
// otherwise ready to enforce — flip the header name below once report noise is
// clean in a real deploy (docs/architecture/app-structure.md records that as an
// owner decision, not an agent's).
//
// Origin inventory connect-src encodes (verify when adding an integration):
//   - ElevenLabs Agents: the browser opens the signed-URL websocket to
//     wss://api.elevenlabs.io (app/_lib/voice/elevenlabs.ts mints the URL
//     server-side). A SELF-HOSTED voice deploy (ELEVENLABS_BASE_URL → your own
//     origin) uses a deploy-specific host — add it here when enforcing.
//   - OpenAI Realtime (WebRTC): the browser POSTs its SDP offer to
//     https://api.openai.com (transport/openai.ts, callsUrl); media then flows
//     over WebRTC, which CSP does not govern.
//   - Plausible (forward-compat): env-gated analytics (NEXT_PUBLIC_PLAUSIBLE_DOMAIN,
//     empty = off) loads its script from and posts events to plausible.io. It is
//     an EXTERNAL src, allowed by host — which is why this policy deliberately
//     does NOT use `'strict-dynamic'` (that would ignore the host allow-list and
//     block it).
//   - Sentry (forward-compat): browser events go to the DSN's ingest host
//     (oNNN.ingest.<region>.sentry.io) — *.sentry.io covers every region.
export function buildCsp(nonce: string): string {
  // In dev, Turbopack/react-refresh evaluate code through `eval`; production
  // does not. `'unsafe-inline'` stays on style-src: next/font and BrandStyle
  // (the white-label accent) both emit inline <style>, and a style injection is
  // not script execution.
  const dev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://plausible.io${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // next/font self-hosts all three faces; data: for inline SVG-in-CSS glyphs.
    "font-src 'self' data:",
    "img-src 'self' data: blob:",
    "connect-src 'self' https://api.elevenlabs.io wss://api.elevenlabs.io https://api.openai.com https://plausible.io https://*.sentry.io",
    // Voice playback buffers; audio worklets load from blob: URLs.
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // The modern half of X-Frame-Options: DENY (next.config.ts keeps the legacy
    // header for old browsers). Ignored while the policy is report-only, which is
    // exactly why it is recorded now rather than discovered at the enforce flip.
    "frame-ancestors 'none'",
  ].join("; ");
}

// 16 random bytes, base64 — unpredictable and unique per request, which is the
// whole security property. `crypto.getRandomValues`/`btoa` are edge-runtime
// globals (no node:crypto, no Buffer, which this file cannot import).
function mintNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function proxy(req: NextRequest): Promise<NextResponse> {
  // 0) Mint the request's nonce before anything can return. EVERY response this
  //    function produces carries the policy — a refusal page is still a document
  //    a browser renders.
  const nonce = mintNonce();
  const csp = buildCsp(nonce);
  const withCsp = <T extends NextResponse>(res: T): T => {
    res.headers.set("Content-Security-Policy-Report-Only", csp);
    return res;
  };
  // The forwarded request carries the ENFORCING header name even though the
  // response is report-only: that name is what Next's renderer greps for the
  // nonce, so report-only alone would leave every script un-nonced and the
  // policy untestable until the day it is enforced.
  const forward = (): NextResponse => {
    const headers = new Headers(req.headers);
    headers.set("Content-Security-Policy", csp);
    headers.set("x-nonce", nonce);
    return withCsp(NextResponse.next({ request: { headers } }));
  };

  // 1) Auth gate first — an unauthenticated request must never reach a recruiter
  //    surface (not even to set a locale cookie). Password set ⇒ enforce sessions;
  //    unset ⇒ open in dev, but FAIL CLOSED in prod (unless KP_ALLOW_OPEN=1).
  const hasPassword = Boolean(process.env.KP_OPERATOR_PASSWORD);
  const failClosed = !hasPassword && process.env.NODE_ENV === "production" && process.env.KP_ALLOW_OPEN !== "1";
  if (hasPassword || failClosed) {
    const { pathname } = req.nextUrl;
    if (!isPublicPath(pathname)) {
      if (failClosed) {
        // Misconfigured production: no operator password. Refuse rather than serve
        // the recruiter surface to the public (set KP_OPERATOR_PASSWORD, or
        // KP_ALLOW_OPEN=1 to run open on purpose).
        if (pathname.startsWith("/api/")) {
          return withCsp(
            NextResponse.json({ error: "Server not configured (KP_OPERATOR_PASSWORD)." }, { status: 503 })
          );
        }
        const url = req.nextUrl.clone();
        url.pathname = "/login";
        url.searchParams.set("next", pathname);
        return withCsp(NextResponse.redirect(url));
      }
      const session = await verifySessionEdge(
        req.cookies.get(SESSION_COOKIE)?.value,
        process.env.KP_SECRET,
        Date.now(),
        sessionEpochFromEnv()
      );
      if (!session) {
        if (pathname.startsWith("/api/")) {
          return withCsp(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
        }
        const url = req.nextUrl.clone();
        url.pathname = "/login";
        url.searchParams.set("next", pathname);
        return withCsp(NextResponse.redirect(url));
      }
    }
  }

  // 2) Locale override — honour `?lang=cs` on candidate-facing links by translating
  //    it into the NEXT_LOCALE cookie the switcher uses (set on the FORWARDED request
  //    so the current render sees it, and on the response for later navigations).
  const lang = req.nextUrl.searchParams.get("lang");
  if (!lang || !isLocale(lang)) return forward();
  if (req.cookies.get(LOCALE_COOKIE)?.value === lang) return forward();

  // `req.cookies.set` rewrites the request's own `cookie` header, so cloning the
  // headers AFTER it (inside forward()) carries the override into the render.
  req.cookies.set(LOCALE_COOKIE, lang);
  const res = forward();
  res.cookies.set(LOCALE_COOKIE, lang, {
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
    sameSite: "lax",
  });
  return res;
}

export const config = {
  // Now also covers /api (the auth gate must protect recruiter APIs); still skips
  // Next internals, the dotless asset routes, and anything with a file extension.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|apple-icon|opengraph-image|.*\\..*).*)"],
};
