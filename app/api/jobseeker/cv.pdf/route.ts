import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { currentSession } from "@/app/_lib/auth/current-user";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { currentUserId } from "@/app/_lib/auth/session";
import { getJobseekerProfile } from "@/app/_lib/db/jobseeker-profiles";
import { pdfOrigin, renderCvPdf } from "@/app/_lib/jobseeker/cv-pdf";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { cvPrintPath } from "@/app/features/jobseeker/cv/cvQuery";

// GET /api/jobseeker/cv.pdf?template=&accent=[&tailor=&compact=&objective=] — the designed CV as a PDF, rendered from
// the print page by a headless Chromium (app/_lib/jobseeker/cv-pdf.ts) so the file keeps
// the layout the seeker previewed. The seeker's own document: a 404 with a code when there
// is no profile, a 503 JOBSEEKER_PDF_UNAVAILABLE when this server has no browser (or the
// render failed) — the client then offers print -> Save as PDF, which carries the same
// layout.
//
// THROTTLE (rate-limit-contract.test.ts): a read, but each hit launches a browser —
// 20/10min per IP, and renders run one at a time behind cv-pdf.ts's queue.
const PDF_RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };

export async function GET(request: Request): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  if (!rateLimit(`jobseeker-cv-pdf:${clientIpFrom(request.headers)}`, PDF_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  // The design (layout, accent, and the tailoring: tailor / compact / objective) passes
  // through to the print page re-validated, so the PDF is the sheet the seeker previewed.
  const printPath = cvPrintPath(new URL(request.url).searchParams);

  let name = "cv";
  try {
    const [session, ws] = await Promise.all([currentSession(), currentWorkspace()]);
    const profile = getJobseekerProfile(currentUserId(session), ws);
    if (!profile) return jsonRefusal("JOBSEEKER_PROFILE_MISSING", 404);
    name = fileSlug(profile.profile.displayName) || "cv";
  } catch (err) {
    return safeJsonError(err, "api:jobseeker/cv.pdf", "JOBSEEKER_STORE_FAILED");
  }

  const origin = pdfOrigin(request.url);
  if (!origin) return jsonRefusal("JOBSEEKER_PDF_UNAVAILABLE", 503);
  const out = await renderCvPdf({ origin, cookieHeader: request.headers.get("cookie"), path: printPath });
  if (out.kind !== "ok") {
    console.error("[api:jobseeker/cv.pdf] JOBSEEKER_PDF_UNAVAILABLE", out.kind === "unavailable" ? out.reason : out.error);
    return jsonRefusal("JOBSEEKER_PDF_UNAVAILABLE", 503);
  }
  return new NextResponse(Buffer.from(out.bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

/** "Jana Nováková" -> "jana-novakova-cv": ASCII only, so the header needs no encoding. */
function fileSlug(name: string | undefined): string {
  const base = (name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base ? `${base}-cv` : "";
}
