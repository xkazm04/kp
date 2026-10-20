import { NextRequest } from "next/server";
import { findEntryByOptOutToken } from "@/app/_lib/db/pipeline";
import { setCandidateChosenLocale } from "@/app/_lib/db/pipeline-locale";
import { isLocale } from "@/i18n/locales";
import { jsonOk, jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { BODY_TOO_LARGE, readJsonWithLimit } from "@/app/_lib/request-body";

// THE CANDIDATE'S LANGUAGE CHOICE, on the unsubscribe door every letter already links.
//
// The locale authority (app/_lib/comms-locale.ts) ranks the candidate's explicit choice
// first, but it could only be captured at apply time, and the CV inference picks Czech
// whenever Czech is declared at all. A person misaddressed by that guess had no way to
// correct it short of stopping the mail altogether. This route is that correction.
//
// POSTURE — the stop door's own (app/api/stop/[token]/route.ts):
//   • the opt-out token is the whole authorization; there is no session, and the tenant
//     comes off the row the token resolved to;
//   • rateLimit runs BEFORE the token lookup, so a flood never reaches the store;
//   • an unknown token answers the stop door's ONE refusal (STOP_LINK_INVALID, 404);
//   • the answer echoes only the stored locale, never a store row.
//
// It is NOT an opt-out: it never writes the outreach halt, and a person who chooses a
// language keeps hearing from us, in that language.

// The same bound as the stop write: a human clicks at most a few times, a script is refused.
const STOP_LANGUAGE_RATE_LIMIT = { limit: 20, windowMs: 60_000 };
// `{"locale":"en"}` is 15 bytes; a public door never buffers an unbounded body.
const MAX_STOP_LANGUAGE_BODY_BYTES = 256;

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    if (!rateLimit(`stop-language:${clientIpFrom(request.headers)}:${token}`, STOP_LANGUAGE_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    const entry = findEntryByOptOutToken(token);
    if (!entry) return jsonRefusal("STOP_LINK_INVALID", 404);
    const body = await readJsonWithLimit<{ locale?: unknown }>(request, MAX_STOP_LANGUAGE_BODY_BYTES, {});
    if (body === BODY_TOO_LARGE) return jsonRefusal("PAYLOAD_TOO_LARGE", 413, { maxBytes: MAX_STOP_LANGUAGE_BODY_BYTES });
    const locale = body.locale;
    if (!isLocale(locale)) return jsonRefusal("STOP_LANGUAGE_INVALID", 400);
    if (setCandidateChosenLocale(entry.id, locale, entry.workspaceId ?? undefined) === 0) {
      // The row went away between the lookup and the write (an erasure): the same
      // refusal as a dead link, so the door still answers one thing for "gone".
      return jsonRefusal("STOP_LINK_INVALID", 404);
    }
    return jsonOk({ locale });
  } catch (error) {
    return safeJsonError(error, "api:stop:language", "STOP_LANGUAGE_FAILED");
  }
}
