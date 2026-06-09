import { NextResponse, type NextRequest } from "next/server";
import { isLocale, LOCALE_COOKIE } from "./i18n/locales";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

// Honour a `?lang=cs` query override so candidate-facing links (offer / apply /
// schedule / interview) can be shared in a specific language without the
// recipient touching a switcher. We translate the override into the same
// `NEXT_LOCALE` cookie the switcher uses — set on the FORWARDED request so the
// current render already sees it (the request config reads cookies), and on the
// response so subsequent navigations stay in that language.
//
// (Next 16's `proxy` file convention — the renamed successor to `middleware`.)
export function proxy(req: NextRequest): NextResponse {
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
  // Run on page navigations only — skip API routes, Next internals, and static
  // assets (anything with a file extension). The override is a page concern.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
