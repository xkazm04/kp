// Source ratchet: only three routes may write an org-owned singleton integration
// config, and each must stamp the owner from the SESSION, after the body.
//
// WHY THIS EXISTS. ADR 0014 (docs/architecture/decisions/
// 0014-org-owned-singleton-integration-config.md) names its own sharpest edge in
// Consequences: "a new door onto one of these rows inherits nothing… a new WRITER
// must pass the caller's org or it will stamp NULL — which silently means 'the
// default org'". Nothing pinned that. The owner check lives inside the store's write
// transaction, so a fourth caller that omits `ownerOrgId` is not a type error, not a
// lint error and not a failing behaviour test: it writes a row whose owner is NULL,
// which the readers fold to `org-default`, and the boundary quietly stops existing
// for that row. Three defects of exactly this shape (F-1, F-2, F-3) were found on one
// day in 2026-10; this file is so the fourth cannot arrive silently.
//
// It is a SOURCE scan, not a behaviour test: the behaviour tests
// (ats-egress-org-scope, comms-relay-org-scope, edge-org-scope) can only cover doors
// that already exist. A ratchet covers the one nobody has written yet.
//
// Making `ownerOrgId` required at the store's type boundary would be the stronger
// answer and was REJECTED (~120 server-internal call sites in tests and fixtures pass
// the option bag without it). ADR 0014's last "what would change our mind" bullet is
// the condition under which that decision flips.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");

/** The one route allowed to call each writer. Not a waiver list — an equality: a
 *  file missing from it fails as a new writer, and a listed file that stopped calling
 *  its writer fails as a stale entry, because a dead expectation is worse than none. */
const CALLERS: Record<string, string> = {
  setAtsConfig: "app/api/ats/config/route.ts",
  setRelayConfig: "app/api/comms/relay/route.ts",
  setEdgeConfig: "app/api/edge/route.ts",
};
const WRITERS = Object.keys(CALLERS);

/** The store modules themselves DEFINE these names; they are not callers. */
const DEFINING_STORES = new Set([
  "app/_lib/ats-config-store.ts",
  "app/_lib/comms-relay-store.ts",
  "app/_lib/edge-config.ts",
]);

/** Comments are prose, not code. Four files name a writer only in a `//` note
 *  explaining the rule (comms.ts, edge-drain.ts, IntegrationsWebhookPanel.tsx, and this
 *  header) — none of them may trip the scan, and none may satisfy it either. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/** The text inside each `fn( … )` in `code`, with brackets balanced and string and
 *  template bodies skipped so a `)` inside a literal cannot end the argument early. */
function callArguments(code: string, fn: string): string[] {
  const out: string[] = [];
  const open = new RegExp(`\\b${fn}\\s*\\(`, "g");
  let match: RegExpExecArray | null;
  while ((match = open.exec(code))) {
    let depth = 1;
    let quote: string | null = null;
    let i = match.index + match[0].length;
    const start = i;
    for (; i < code.length && depth > 0; i += 1) {
      const ch = code[i];
      if (quote) {
        if (ch === "\\") i += 1;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "(" || ch === "{" || ch === "[") depth += 1;
      else if (ch === ")" || ch === "}" || ch === "]") depth -= 1;
    }
    out.push(code.slice(start, i - 1));
    open.lastIndex = i;
  }
  return out;
}

const ADR = "ADR 0014 §1: a writer must stamp the owner from the session, spread AFTER the body";

/** What is wrong with one accepted caller's source? Shared by the tree scan and the
 *  fixtures below, so the fixtures prove the same code that guards the tree. */
function findingsForAcceptedCaller(rel: string, writer: string, code: string, args: string[]): string[] {
  const findings: string[] = [];

  // 1. The constant itself: derived from the session, never read off the body.
  const decl = /\bconst\s+ownerOrgId\s*=\s*([^;]*);/.exec(code);
  if (!decl) {
    findings.push(`${rel}: calls ${writer} but never declares ownerOrgId — ${ADR}`);
  } else if (!/currentOrgId\s*\(\s*await\s+currentSession\s*\(\s*\)\s*\)/.test(decl[1])) {
    findings.push(`${rel}: ownerOrgId is assigned from \`${decl[1].trim()}\`, not from currentOrgId(await currentSession()) — ${ADR}`);
  } else if (/\bbody\b/.test(decl[1])) {
    findings.push(`${rel}: ownerOrgId reads the request body — ${ADR}`);
  }

  // 2. The call: ownerOrgId spread AFTER the body, so a body field cannot override it.
  for (const arg of args) {
    const spreads = [...arg.matchAll(/\.\.\.\s*[A-Za-z_$][\w$]*/g)];
    const stamp = /\bownerOrgId\b/.exec(arg);
    if (!stamp) {
      findings.push(`${rel}: ${writer}({ … }) does not pass ownerOrgId at all — it would stamp NULL, which reads as the default org. ${ADR}`);
      continue;
    }
    if (/\bownerOrgId\s*:/.test(arg)) {
      findings.push(`${rel}: ${writer} is passed an inline ownerOrgId instead of the session-derived constant — ${ADR}`);
      continue;
    }
    if (spreads.length === 0) {
      findings.push(`${rel}: ${writer} no longer spreads the parsed body, so the order rule this ratchet checks does not apply — re-read ${ADR} and update this test deliberately`);
      continue;
    }
    const lastSpread = spreads[spreads.length - 1];
    if ((lastSpread.index ?? 0) > stamp.index) {
      findings.push(`${rel}: ${writer} spreads \`${lastSpread[0]}\` AFTER ownerOrgId, so a body field overrides the session stamp — ${ADR}`);
    }
  }
  return findings;
}

/** The whole audit over a set of (path, source) pairs. */
function auditTree(files: { rel: string; source: string }[]): { findings: string[]; callSites: number } {
  const findings: string[] = [];
  const seen = new Set<string>();
  let callSites = 0;

  for (const { rel, source } of files) {
    if (DEFINING_STORES.has(rel)) continue;
    const code = stripComments(source);
    for (const writer of WRITERS) {
      const args = callArguments(code, writer);
      if (args.length === 0) continue;
      callSites += args.length;
      seen.add(`${writer}@${rel}`);
      if (CALLERS[writer] !== rel) {
        findings.push(
          `${rel}: a NEW writer of ${writer} — only ${CALLERS[writer]} may write this row. ` +
            `${ADR}. If this caller is legitimate, it must derive ownerOrgId from the session and be added here deliberately.`,
        );
        continue;
      }
      findings.push(...findingsForAcceptedCaller(rel, writer, code, args));
    }
  }

  for (const writer of WRITERS) {
    if (!seen.has(`${writer}@${CALLERS[writer]}`)) {
      findings.push(`${CALLERS[writer]}: listed as the only caller of ${writer} but no longer calls it — stale entry, fix the list`);
    }
  }
  return { findings, callSites };
}

function sourceFiles(): { rel: string; source: string }[] {
  const out: { rel: string; source: string }[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(name) || /\.test\./.test(name)) continue;
      out.push({ rel: path.relative(ROOT, full).split(path.sep).join("/"), source: readFileSync(full, "utf8") });
    }
  };
  for (const top of ["app", "lib"]) {
    const dir = path.join(ROOT, top);
    if (existsSync(dir)) walk(dir);
  }
  return out;
}

test("only the three known routes write an org-owned singleton config, each stamping the session org", () => {
  const files = sourceFiles();

  // NON-VACUITY: a scan that visited nothing, or whose matcher broke, passes forever.
  assert.ok(files.length >= 500, `the scan visited ${files.length} source file(s) — it must see the real tree`);

  const { findings, callSites } = auditTree(files);
  assert.ok(callSites >= WRITERS.length, `the scan found ${callSites} call site(s); each of the ${WRITERS.length} writers has at least one`);
  assert.deepEqual(findings, [], "an org-owned singleton integration config is written outside ADR 0014's rule");
});

test("the ratchet bites on each defect shape (fixtures)", () => {
  const route = (call: string, decl = "const ownerOrgId = currentOrgId(await currentSession()) ?? DEFAULT_ORG_ID;") => `
    import { setEdgeConfig } from "@/app/_lib/edge-config";
    export async function POST(request: Request) {
      const body = (await request.json()) as { url?: unknown };
      ${decl}
      return NextResponse.json({ ok: true, config: ${call} });
    }`;
  const good = [
    { rel: "app/api/ats/config/route.ts", source: route("setAtsConfig({ ...body, ownerOrgId })") },
    { rel: "app/api/comms/relay/route.ts", source: route("setRelayConfig({ ...body, ownerOrgId })") },
    { rel: "app/api/edge/route.ts", source: route("setEdgeConfig({ ...body, ownerOrgId })") },
  ];
  assert.deepEqual(auditTree(good).findings, [], "the shipped shape must pass");
  assert.equal(auditTree(good).callSites, 3);

  const mutate = (rel: string, source: string) => good.map((f) => (f.rel === rel ? { rel, source } : f));

  // (a) body spread LAST — the session stamp is overridden by whatever the caller sent.
  const bodyLast = auditTree(mutate("app/api/edge/route.ts", route("setEdgeConfig({ ownerOrgId, ...body })"))).findings;
  assert.equal(bodyLast.length, 1, bodyLast.join(" | "));
  assert.match(bodyLast[0], /spreads `\.\.\.body` AFTER ownerOrgId/);
  assert.match(bodyLast[0], /ADR 0014/);

  // (b) ownerOrgId read off the body instead of the session.
  const fromBody = auditTree(
    mutate("app/api/comms/relay/route.ts", route("setRelayConfig({ ...body, ownerOrgId })", "const ownerOrgId = (body as { ownerOrgId?: string }).ownerOrgId ?? DEFAULT_ORG_ID;")),
  ).findings;
  assert.equal(fromBody.length, 1, fromBody.join(" | "));
  assert.match(fromBody[0], /not from currentOrgId\(await currentSession\(\)\)/);

  // …and the same defect worn as an inline property on the call.
  const inline = auditTree(mutate("app/api/edge/route.ts", route("setEdgeConfig({ ...body, ownerOrgId: body.ownerOrgId })"))).findings;
  assert.equal(inline.length, 1, inline.join(" | "));
  assert.match(inline[0], /inline ownerOrgId instead of the session-derived constant/);

  // (c) a FOURTH caller — the edge ADR 0014 names as its sharpest.
  const fourth = auditTree([...good, { rel: "app/api/admin/edge-reset/route.ts", source: route("setEdgeConfig({ url: \"\" })") }]).findings;
  assert.equal(fourth.length, 1, fourth.join(" | "));
  assert.match(fourth[0], /a NEW writer of setEdgeConfig/);
  assert.match(fourth[0], /must stamp the owner from the session/);

  // (d) a listed route that stopped calling its writer is a stale entry, not a pass.
  const stale = auditTree(good.filter((f) => f.rel !== "app/api/ats/config/route.ts")).findings;
  assert.equal(stale.length, 1, stale.join(" | "));
  assert.match(stale[0], /no longer calls it — stale entry/);

  // (e) no ownerOrgId at all: the NULL stamp this ratchet exists for.
  const unstamped = auditTree(mutate("app/api/edge/route.ts", route("setEdgeConfig({ ...body })"))).findings;
  assert.equal(unstamped.length, 1, unstamped.join(" | "));
  assert.match(unstamped[0], /does not pass ownerOrgId at all/);

  // (f) prose is not code: a comment naming a writer neither trips nor satisfies the scan.
  const commentOnly = auditTree([...good, { rel: "app/_lib/comms.ts", source: "// `setRelayConfig` vets it with assertPublicHttpsEndpoint.\nexport const x = 1;" }]);
  assert.deepEqual(commentOnly.findings, []);
  assert.equal(commentOnly.callSites, 3, "a commented-out call must not count as a call site");
});
