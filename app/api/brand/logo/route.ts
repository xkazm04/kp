import { NextRequest, NextResponse } from "next/server";
import { clearLogo, getLogo, saveLogo } from "@/app/_lib/brand-store";
import { MAX_LOGO_BYTES, validateLogoUpload } from "@/app/_lib/brand-logo";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireOrgCapability } from "@/app/_lib/auth/current-user";
import { jsonOk, jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { readBytesWithLimit } from "@/app/_lib/request-body";

// The uploaded company logo (docs/features/organization/README.md "Logo upload").
//   GET    — PUBLIC (app/_lib/auth/public-routes.ts): candidate pages have no session
//            and render this as an <img>. Read-only, carries no secret. Nothing else
//            under /api/brand is public.
//   POST   — upload the raw file body (PNG or SVG). org:manage, like PUT /api/brand.
//   DELETE — remove it. Same gate.
// Because the path is public at the proxy, the write handlers re-verify the session and
// the capability themselves; a public path is never the authorization. They are NOT
// wrapped in withSession (route-workspace-coverage: a public route is not a session
// route), and requireOperator is what answers the 401 in a password-protected install.

/** The upload cap, named at the top of the route (public-body-cap-contract). The value
 *  lives in brand-logo.ts so the validator and the client check share it. */
const MAX_LOGO_UPLOAD_BYTES = MAX_LOGO_BYTES;

const LOGO_RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };

/** The served bytes are untrusted markup (an SVG). nosniff pins the type, and the CSP
 *  sandbox + default-src 'none' means that even opened directly as a document no script
 *  runs and nothing external loads. */
const SERVE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  "Cache-Control": "public, no-cache",
} as const;

export async function GET(request: NextRequest): Promise<NextResponse> {
  let logo;
  try {
    logo = getLogo();
  } catch (error) {
    return safeJsonError(error, "api:brand:logo:get", "BRAND_LOAD_FAILED");
  }
  if (!logo) return new NextResponse(null, { status: 404, headers: { "X-Content-Type-Options": "nosniff" } });
  const etag = `"${logo.hash}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ...SERVE_HEADERS, ETag: etag } });
  }
  return new NextResponse(new Uint8Array(logo.bytes), {
    status: 200,
    headers: { ...SERVE_HEADERS, "Content-Type": logo.mime, "Content-Length": String(logo.bytes.byteLength), ETag: etag },
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  const forbidden = await requireOrgCapability("org:manage");
  if (forbidden) return forbidden;
  if (!rateLimit(`brand-logo:${clientIpFrom(request.headers)}`, LOGO_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  // The cap is measured on the bytes READ; content-length is advisory.
  const bytes = await readBytesWithLimit(request, MAX_LOGO_UPLOAD_BYTES);
  if (bytes === null) return jsonRefusal("BRAND_LOGO_TOO_LARGE", 413, { maxBytes: MAX_LOGO_BYTES });
  const verdict = validateLogoUpload(bytes);
  if (!verdict.ok) return jsonRefusal(verdict.code, verdict.code === "BRAND_LOGO_TOO_LARGE" ? 413 : 400, { maxBytes: MAX_LOGO_BYTES });
  try {
    return jsonOk(saveLogo(bytes, verdict.mime));
  } catch (error) {
    return safeJsonError(error, "api:brand:logo:post", "BRAND_SAVE_FAILED");
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  const forbidden = await requireOrgCapability("org:manage");
  if (forbidden) return forbidden;
  if (!rateLimit(`brand-logo:${clientIpFrom(request.headers)}`, LOGO_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    return jsonOk(clearLogo());
  } catch (error) {
    return safeJsonError(error, "api:brand:logo:delete", "BRAND_SAVE_FAILED");
  }
}
