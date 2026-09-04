import { NextRequest } from "next/server";
import { getBrand, saveBrand } from "@/app/_lib/brand-store";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { jsonOk, jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { resolveAccent, sanitizeLogoUrl, type AccentRejection } from "@/app/_lib/brand-config";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { BODY_TOO_LARGE, readJsonWithLimit } from "@/app/_lib/request-body";

// White-label brand config (E3, docs/product/enterprise-readiness.md §4).
//   GET  — the effective brand (name/accent/logo + the derived dark accent).
//          Public-readable: the nav and the candidate-facing surfaces render it and
//          it carries no secrets.
//   PUT  — operator-only; validates (app/_lib/brand-config.ts) then persists.

// Per-IP budget on the WRITE. This door re-skins the ENTIRE app — every button,
// focus ring and active-nav bar, on the workspace AND on the candidate-facing
// offer/apply/schedule pages — by injecting a value into a server-rendered <style>.
// It is operator-gated, and open mode (KP_OPERATOR_PASSWORD unset) makes that gate a
// documented no-op for the whole API, so the limiter is the real bound: without it a
// loop could churn the workspace's visual identity, and each answer was an unmetered
// oracle telling the caller exactly which colors the contrast rule accepts. 30/10min
// is far above an operator editing a form.
const BRAND_RATE_LIMIT = { limit: 30, windowMs: 10 * 60_000 };

/** Three short strings and a URL. `content-length` is advisory, so the real cap is
 *  measured on the bytes read off the wire (readJsonWithLimit). 4 KB is ~8x the
 *  largest legitimate body (a 60-char name + a hex + a 500-char logo URL). */
const MAX_BRAND_BODY_BYTES = 4_000;

/** One refusal code per reason the accent cannot be stored — the reason is the
 *  information, so it is never collapsed into a single "invalid color". A legibility
 *  failure NAMES ITS THEME, because the operator's next move differs: Studio Light
 *  means "pick a darker color", Spark Dark means "this one has no twin that is still
 *  your brand". */
const ACCENT_REFUSAL = {
  invalid: "BRAND_ACCENT_INVALID",
  "illegible-light": "BRAND_ACCENT_ILLEGIBLE_LIGHT",
  "illegible-dark": "BRAND_ACCENT_ILLEGIBLE_DARK",
} as const satisfies Record<AccentRejection, string>;

export async function GET() {
  try {
    return jsonOk(getBrand());
  } catch (error) {
    // better-sqlite3 throws with the absolute db path inside SQLITE_* text; it goes
    // to the server log and the caller gets the code.
    return safeJsonError(error, "api:brand:get", "BRAND_LOAD_FAILED");
  }
}

export async function PUT(request: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  // AFTER the operator gate, so a rejected caller never spends the budget, and
  // before any body read or store work.
  if (!rateLimit(`brand:${clientIpFrom(request.headers)}`, BRAND_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  const body = await readJsonWithLimit<Record<string, unknown>>(request, MAX_BRAND_BODY_BYTES, {});
  if (body === BODY_TOO_LARGE) return jsonRefusal("PAYLOAD_TOO_LARGE", 413, { maxBytes: MAX_BRAND_BODY_BYTES });

  // The accent is REFUSED, not silently dropped. saveBrand still sanitizes (the read
  // path must degrade rather than throw), but a write that answered 200 with the
  // color quietly replaced by null told the operator their brand had been applied
  // when it had not — and gave them nothing to act on. `resolveAccent` also returns
  // the derived Spark Dark twin, so both themes are decided in one place.
  const accent = resolveAccent(body.accentColor);
  if (!accent.ok) return jsonRefusal(ACCENT_REFUSAL[accent.reason], 400);
  // Same rule for the logo: a non-https URL (an <img src> injection vector) or one
  // past MAX_LOGO_URL (a truncated signed CDN URL that would 403 forever) is a
  // refusal the editor can show, not a null the editor has to infer.
  const rawLogo = typeof body.logoUrl === "string" ? body.logoUrl.trim() : "";
  if (rawLogo && sanitizeLogoUrl(rawLogo) === null) return jsonRefusal("BRAND_LOGO_INVALID", 400);

  try {
    return jsonOk(saveBrand(body));
  } catch (error) {
    return safeJsonError(error, "api:brand:put", "BRAND_SAVE_FAILED");
  }
}
