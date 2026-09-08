import { NextRequest } from "next/server";
import { getJob } from "@/app/_lib/db/jobs";
import { findEntryByOptOutToken, recordAutomationEvent } from "@/app/_lib/db/pipeline";
import { candidateOptOutHalt, recordCandidateOptOut } from "@/app/_lib/outreach-state-store";
import { jsonOk, jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// THE UNSUBSCRIBE DOOR (ePrivacy Art. 13(4); Czech § 7(4)(c) with § 11(2)(a)(4) of
// zák. č. 480/2004 Sb., a standalone offence with a fine up to 10,000,000 Kč; German
// UWG § 7(2) No. 2).
//
// kp sends candidate outreach — including talent-rediscovery campaigns to people who
// never applied — and until this route existed there was no way for a candidate to make
// it stop. What existed was the GDPR footer to /data/[token]: an Art. 15/17 affordance,
// which is a DIFFERENT right. Offering a person who only wants the mail to stop the
// single option of erasing their whole application is precisely the coupling the law
// forbids, so this is a second, narrower door rather than a branch of that one.
//
// POSTURE — copied deliberately from /api/data/[token] and /api/status/[token]:
//   • the token is an opaque CSPRNG capability (ensureOptOutToken) and carries NO
//     session; it is matched against `optout_token` ALONE, so an erasure token
//     presented here resolves to nothing and this token opens neither the held-data
//     projection nor the erasure write;
//   • the GET answers an explicit field ALLOWLIST — the role title, the company, and
//     whether the stop is already recorded. Never the entry id, the candidate's name,
//     their score, stage, archetype or reasoning;
//   • ONE refusal (STOP_LINK_INVALID, 404) covers "no such token" and "no such entry"
//     identically, so the door is not an existence oracle;
//   • rateLimit runs BEFORE the token lookup on both verbs, so a flood is rejected
//     without touching the store — the rule /api/data/[token] states for its
//     irreversible write, and this write, while not irreversible, is a legal record.
//
// The stop is NOT an erasure and NOT a withdrawal of the application: it halts outreach
// and nothing else. The page says so in the candidate's own language and offers the
// erasure link beside it for someone who wants that instead.

// The view is loaded once per page open and re-read after a stop; 60/min is the same
// budget the status and data reads carry, more than an order of magnitude of headroom.
const STOP_VIEW_RATE_LIMIT = { limit: 60, windowMs: 60_000 };
// The write is tighter but NOT as tight as the erasure's: a mail client that honours
// RFC 8058 may POST the one-click unsubscribe on the reader's behalf, and a human who
// does not see an instant confirmation clicks again. 20/min is generous for both and
// still hostile to a script. The write is idempotent, so a repeat costs nothing.
const STOP_WRITE_RATE_LIMIT = { limit: 20, windowMs: 60_000 };

/** The candidate-safe projection. An explicit allowlist, built field by field from the
 *  entry — never a serialized store row (the house rule for every public token route,
 *  see publicInviteView in app/api/schedule/[token]/route.ts). */
function stopView(entry: { id: string; jobTitle: string | null; jobId: string | null }) {
  return {
    jobTitle: entry.jobTitle ?? null,
    company: entry.jobId ? getJob(entry.jobId)?.company ?? null : null,
    // Whether the objection is ALREADY on file — resolved at the durable candidate
    // identity, exactly as the send gate resolves it, so the page cannot tell a
    // candidate "you are still subscribed" about a person the sender already refuses to
    // mail. A candidate who opted out from one role's letter and opens the link in an
    // older letter about another role sees the truth: it is already stopped.
    stopped: candidateOptOutHalt(entry.id) != null,
  };
}

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    if (!rateLimit(`stop-view:${clientIpFrom(request.headers)}:${token}`, STOP_VIEW_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    const entry = findEntryByOptOutToken(token);
    if (!entry) return jsonRefusal("STOP_LINK_INVALID", 404);
    return jsonOk(stopView(entry));
  } catch (error) {
    return safeJsonError(error, "api:stop", "STOP_LOOKUP_FAILED");
  }
}

/** Record the candidate's opt-out. Idempotent: a replay (a second click, a mail client
 *  pre-fetching the one-click unsubscribe) records nothing new and answers the same
 *  thing, so the door behaves identically for a human and for a machine.
 *
 *  Accepts an EMPTY body and also the RFC 8058 one-click form body
 *  (`List-Unsubscribe=One-Click`). Nothing is read out of it — the token in the path is
 *  the whole authorization, and parsing a body we do not need would only add a way to
 *  fail — but accepting the content type is what lets a mail provider wire this route
 *  straight to the List-Unsubscribe-Post header.
 *
 *  TENANT: the workspace comes off the row the TOKEN resolved to, never a session —
 *  this is a public capability-link route and has none. Same reasoning, and the same
 *  bug it avoids, as the erasure door: a bare call would target the default workspace
 *  and silently write nothing for any candidate outside it, while still answering
 *  `{ stopped: true }`. */
export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    // Throttle BEFORE the lookup: the store is never the cheap thing a flood reaches.
    if (!rateLimit(`stop-write:${clientIpFrom(request.headers)}:${token}`, STOP_WRITE_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    const entry = findEntryByOptOutToken(token);
    if (!entry) return jsonRefusal("STOP_LINK_INVALID", 404);
    recordCandidateOptOut(entry.id, entry.workspaceId ?? undefined);
    // Audit the objection the same way every suppression is audited: a compliance fact
    // an operator may have to evidence must not exist only as a column. Best-effort —
    // the stop itself is already durable, and failing the request after the write
    // landed would tell the candidate their opt-out did not take when it did.
    try {
      recordAutomationEvent(entry.id, "outreach_opted_out", "candidate", entry.workspaceId);
    } catch (e) {
      console.error(`[stop] opt-out recorded but the audit write failed for entry ${entry.id}: ${e instanceof Error ? e.message : e}`);
    }
    return jsonOk({ stopped: true });
  } catch (error) {
    return safeJsonError(error, "api:stop", "STOP_FAILED");
  }
}
