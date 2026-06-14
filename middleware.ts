import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionEdge } from "@/app/_lib/auth/edge-verify";

// Auth foundation (P2) — the recruiter-surface gate. FAIL-CLOSED: every path is
// gated EXCEPT an explicit allow-list of public-by-design surfaces (candidate
// token pages/APIs, external webhooks, auth, marketing, health). A forgotten
// recruiter route therefore stays gated (safe); a forgotten public route sends a
// candidate to /login (visible + fixable) — never a PII leak.
//
// OPT-IN: with KP_OPERATOR_PASSWORD unset the app runs open (no regression for
// existing single-operator deploys). Prod sets it to enforce + close ccb4d851.

// Public PAGE prefixes (candidate token pages + marketing + login).
const PUBLIC_PAGES = ["/login", "/about", "/landing", "/apply/", "/offer/", "/schedule/", "/interview/", "/status/", "/skill/", "/devcase/apply/"];
// Public API prefixes (whole namespaces that are candidate/webhook-only).
const PUBLIC_API_PREFIXES = ["/api/auth/", "/api/apply/", "/api/offer/", "/api/status/", "/api/skill-profile/", "/api/devcase/session", "/api/channels/"];
// Public API EXACT paths (siblings in a mostly-recruiter namespace).
const PUBLIC_API_EXACT = new Set([
  "/api/health",
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

export async function middleware(req: NextRequest) {
  // Opt-in: no operator password configured → auth disabled (passthrough).
  if (!process.env.KP_OPERATOR_PASSWORD) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySessionEdge(token, process.env.KP_SECRET);
  if (session) return NextResponse.next();

  // Unauthenticated on a gated surface.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except Next internals + static asset routes (which are public
  // by nature and would otherwise pay the middleware cost).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon|opengraph-image|robots.txt|sitemap.xml).*)",
  ],
};
