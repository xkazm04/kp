// The EXACT set of API routes the auth proxy lets through with no session.
//
// public-body-cap-contract.test.ts derives the public set and asserts a body cap on
// it; public-routes.test.ts pins sample paths; `npm run api:check` only fails when
// docs/architecture/api-reference.md drifts from the tree, so a new public route plus a
// regenerated table is green. Nothing pinned MEMBERSHIP. This does: widening (or
// narrowing) the unauthenticated surface is now an edit to PUBLIC_SURFACE below, each
// entry with the reason it is allowed to be anonymous, reviewed as a deliberate act.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isPublicPath } from "../_lib/auth/public-routes.ts";

const API_DIR = fileURLToPath(new URL(".", import.meta.url));

const PUBLIC_SURFACE: Record<string, string> = {
  "/api/agents/report/[token]": "agent report intake; the report token in the path is the credential",
  "/api/apply/[id]": "candidate application form on a public role link",
  "/api/apply/[id]/followup": "candidate application follow-up answers",
  "/api/apply/[id]/quick": "candidate one-step quick apply",
  "/api/apply/[id]/session": "candidate application session bootstrap",
  "/api/auth/login": "sign-in; cannot require a session",
  "/api/auth/logout": "sign-out; must work with an expired session",
  "/api/auth/register": "account creation; cannot require a session",
  "/api/auth/switch-workspace": "workspace switch; public only via the /api/auth/ prefix, so the route must re-verify the session itself",
  "/api/billing/webhook": "Polar machine webhook; authenticated by signature",
  "/api/channels/inbound/[token]": "inbound channel webhook; the token in the path is the credential",
  "/api/comms/callback": "mail-provider delivery callback; machine webhook",
  "/api/data/[token]": "GDPR erasure/export capability link",
  "/api/demo": "public demo surface",
  "/api/devcase/inbound": "devcase inbound machine webhook",
  "/api/devcase/session": "candidate work-sample session start (tokenized capability link)",
  "/api/devcase/session/[id]": "candidate work-sample session read/update",
  "/api/devcase/session/[id]/chat": "candidate work-sample chat",
  "/api/devcase/session/[id]/submit": "candidate work-sample submission",
  "/api/extract-text": "CV text extraction for the public apply flow",
  "/api/health": "liveness probe",
  "/api/interview/complete": "candidate AI interview completion (token surface)",
  "/api/interview/connect": "candidate AI interview connection (token surface)",
  "/api/interview/director": "candidate AI interview director turn (token surface)",
  "/api/interview/recording": "candidate AI interview recording upload (token surface)",
  "/api/invite/[token]": "team invite acceptance; the invite token is the credential",
  "/api/offer/[token]": "candidate offer view/response; capability link",
  "/api/schedule/[token]": "candidate self-scheduling; capability link",
  "/api/skill-profile/[token]/verify": "skill-profile verification; capability link",
  "/api/status/[token]": "candidate status page; capability link",
  "/api/status/[token]/decisions": "candidate status: decisions; capability link",
  "/api/status/[token]/letter": "candidate status: letter; capability link",
  "/api/status/[token]/nps": "candidate status: NPS; capability link",
  "/api/status/[token]/recording": "candidate recording deletion; capability link",
  "/api/status/[token]/resend": "candidate status link re-send; capability link",
  "/api/stop/[token]": "one-click opt-out (RFC 8058); capability link",
  "/api/stop/[token]/language": "opt-out page language switch; capability link",
};

/** Every `route.ts` under app/api as a URL path (`[id]` / `[token]` stay literal). */
function routeUrls(): string[] {
  const out: string[] = [];
  (function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const p = path.join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (entry === "route.ts") {
        const rel = path.relative(API_DIR, p).split(path.sep).join("/").replace(/\/?route\.ts$/, "");
        out.push("/api" + (rel ? "/" + rel : ""));
      }
    }
  })(API_DIR);
  return out.sort();
}

test("the public API surface equals the committed, justified list", () => {
  const actual = routeUrls().filter((u) => isPublicPath(u));
  const expected = Object.keys(PUBLIC_SURFACE).sort();
  const added = actual.filter((u) => !expected.includes(u));
  const removed = expected.filter((u) => !actual.includes(u));
  assert.deepEqual(
    { added, removed },
    { added: [], removed: [] },
    "The set of unauthenticated routes changed. `added` became public without an entry in " +
      "PUBLIC_SURFACE (app/api/public-api-surface-contract.test.ts): add one WITH the reason it may be " +
      "anonymous, and update docs/architecture/api-reference.md. `removed` no longer exists or is no longer " +
      "public: delete its entry."
  );
});

test("every public-surface entry carries a real justification", () => {
  for (const [url, why] of Object.entries(PUBLIC_SURFACE)) {
    assert.ok(why.trim().length >= 12, `${url} needs a one-line reason`);
  }
});
