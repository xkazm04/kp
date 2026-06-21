import { NextResponse, type NextRequest } from "next/server";
import { isLocale, LOCALE_COOKIE } from "./i18n/locales";
import { SESSION_COOKIE, verifySessionEdge } from "./app/_lib/auth/edge-verify";

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
const PUBLIC_PAGES = ["/login", "/about", "/landing", "/apply/", "/offer/", "/schedule/", "/interview/", "/status/", "/skill/", "/devcase/apply/"];
const PUBLIC_API_PREFIXES = ["/api/auth/", "/api/apply/", "/api/offer/", "/api/status/", "/api/skill-profile/", "/api/devcase/session", "/api/channels/"];
const PUBLIC_API_EXACT = new Set([
  "/api/health",
  "/api/demo", // public entry: mints an isolated "demo"-workspace session for the guided sim
  "/api/extract-text",
  "/api/billing/webhook", // Polar posts here; the rest of /api/billing is recruiter
  "/api/devcase/inbound", // candidate apply webhook; the rest of /api/devcase is recruiter
  "/api/interview/connect", // candidate voice runtime; create/by-entry/compare/revoke are recruiter
  "/api/interview/complete",
]);

function isPublic(p: string): boolean {
  if (PUBLIC_API_EXACT.has(p)) return true;
  if (PUBLIC_API_PREFIXES.some((x) => p === x || p.startsWith(x))) return true;
  // Candidate schedule token routes are public; the recruiter invite endpoint is not.
  if (p.startsWith("/api/schedule/") && p !== "/api/schedule/invite") return true;
  if (PUBLIC_PAGES.some((x) => p === x || p.startsWith(x))) return true;
  return false;
}

// A global session-kill epoch (KP_SESSION_EPOCH): bumping it invalidates every
// issued session at once, WITHOUT rotating KP_SECRET (which also encrypts stored
// provider keys). Read inline — the proxy is edge-safe and can't import session.ts
// (node:crypto). Default 0 ⇒ nothing invalidated.
function sessionEpochFromEnv(): number {
  const n = Number.parseInt(process.env.KP_SESSION_EPOCH ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function proxy(req: NextRequest): Promise<NextResponse> {
  // 1) Auth gate first — an unauthenticated request must never reach a recruiter
  //    surface (not even to set a locale cookie). Password set ⇒ enforce sessions;
  //    unset ⇒ open in dev, but FAIL CLOSED in prod (unless KP_ALLOW_OPEN=1).
  const hasPassword = Boolean(process.env.KP_OPERATOR_PASSWORD);
  const failClosed = !hasPassword && process.env.NODE_ENV === "production" && process.env.KP_ALLOW_OPEN !== "1";
  if (hasPassword || failClosed) {
    const { pathname } = req.nextUrl;
    if (!isPublic(pathname)) {
      if (failClosed) {
        // Misconfigured production: no operator password. Refuse rather than serve
        // the recruiter surface to the public (set KP_OPERATOR_PASSWORD, or
        // KP_ALLOW_OPEN=1 to run open on purpose).
        if (pathname.startsWith("/api/")) {
          return NextResponse.json({ error: "Server not configured (KP_OPERATOR_PASSWORD)." }, { status: 503 });
        }
        const url = req.nextUrl.clone();
        url.pathname = "/login";
        url.searchParams.set("next", pathname);
        return NextResponse.redirect(url);
      }
      const session = await verifySessionEdge(
        req.cookies.get(SESSION_COOKIE)?.value,
        process.env.KP_SECRET,
        Date.now(),
        sessionEpochFromEnv()
      );
      if (!session) {
        if (pathname.startsWith("/api/")) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const url = req.nextUrl.clone();
        url.pathname = "/login";
        url.searchParams.set("next", pathname);
        return NextResponse.redirect(url);
      }
    }
  }

  // 2) Locale override — honour `?lang=cs` on candidate-facing links by translating
  //    it into the NEXT_LOCALE cookie the switcher uses (set on the FORWARDED request
  //    so the current render sees it, and on the response for later navigations).
  const lang = req.nextUrl.searchParams.get("lang");
  if (!lang || !isLocale(lang)) return NextResponse.next();
  if (req.cookies.get(LOCALE_COOKIE)?.value === lang) return NextResponse.next();

  req.cookies.set(LOCALE_COOKIE, lang);
  const res = NextResponse.next({ request: req });
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
