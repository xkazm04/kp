// Capability-boundary guard for PATCH /api/schedule (the interview "Join" link).
// The meeting link is rendered as the trusted coral "Join" button on the
// recruiter agenda and baked into both calendar events, so writing it is a
// RECRUITER capability. The PATCH handler used to require only body.token — the
// candidate's own capability — with no currentWorkspace() resolution and no
// invite.workspaceId check, so a token holder could inject an attacker-controlled
// link into the recruiter surface (and edit another team's invite cross-tenant).
//
// The route can't be driven behaviorally here (currentWorkspace() reads cookies()
// which throws outside a request), so this is a SOURCE GUARD: the PATCH handler
// must resolve the tenant and refuse a foreign/candidate token before writing —
// mirroring the POST handler's invite.workspaceId !== ws check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

test("PATCH /api/schedule resolves the tenant and rejects a foreign/candidate token before writing the meeting link", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(dir, "route.ts"), "utf8");
  const patch = src.slice(src.indexOf("export async function PATCH"));
  assert.ok(patch.length > 0, "PATCH handler must exist");
  assert.match(patch, /currentWorkspace\(\)/, "PATCH must resolve currentWorkspace()");
  assert.match(patch, /getScheduleInviteByToken\(/, "PATCH must load the invite to check ownership");
  assert.match(patch, /invite\.workspaceId\s*!==\s*ws/, "PATCH must 404 when the invite is outside the caller's workspace");
});
