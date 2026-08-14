import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// ROUTE-LAYER tenancy guard — the missing half of the tenancy test suite.
//
// The 40-odd `*-tenancy.test.ts` files pin the SQL inside store modules: that
// listPipeline filters on workspace_id, that decision_records chains per tenant.
// Every one of them passed while the app leaked, because the defect was never in the
// SQL. It was one layer up: ~200 store functions DEFAULT their tenant —
//
//     export function listPipeline(workspaceId: string = DEFAULT_WORKSPACE_ID)
//
// — so a ROUTE that omits the argument silently reads or writes the DEFAULT team, and
// no store-level test can see it. The multi-workspace audit found ~90 such call sites
// across 24 tabs; the store tests found none of them.
//
// This closes that gap statically and as a RATCHET: it derives the tenant-defaulting
// functions from the source, finds every route-layer call that omits the argument, and
// asserts the offender set is exactly the documented allowlist below. A new route that
// forgets the tenant fails CI instead of shipping a cross-tenant read.
//
// It is deliberately a source scan, not a behavioural test: route handlers need a
// request scope the unit runner cannot give them, and the property being asserted —
// "the argument is present at the call site" — is exactly what the source states.

const apiDir = path.dirname(fileURLToPath(import.meta.url));
const libDir = path.resolve(apiDir, "..", "_lib");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules") walk(p, out);
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
      out.push(p);
    }
  }
  return out;
}

/** Strip // and block comments, quote-aware so a URL inside a string survives.
 *
 *  Load-bearing: this codebase documents parameters with multi-line comments INSIDE
 *  the parameter list, and those sentences contain commas. Splitting without
 *  stripping them counts prose as parameters and inflates the tenant's index — which
 *  then reports correct call sites as offenders. actOnPipelineEntry is the example:
 *  5 real parameters, but its `actor` comment makes a naive splitter see 7. */
function stripComments(s: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quote) {
      out += c;
      if (c === quote && s[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      continue;
    }
    if (c === "/" && s[i + 1] === "/") {
      while (i < s.length && s[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    if (c === "/" && s[i + 1] === "*") {
      i += 2;
      while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) i += 1;
      i += 1;
      continue;
    }
    out += c;
  }
  return out;
}

/** Split on top-level commas. Tracks (), [], {} and strings — deliberately NOT < >:
 *  arrow functions (`=>`) are everywhere in call arguments, and treating `>` as a
 *  closer under-counts them, which reads as a missing tenant that is really present. */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  let quote: string | null = null;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quote) {
      cur += c;
      if (c === quote && s[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      cur += c;
      continue;
    }
    if ("([{".includes(c)) depth += 1;
    else if (")]}".includes(c)) depth -= 1;
    if (c === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Remove balanced generic type-argument spans, quote-aware.
 *
 *  Applied to PARAMETER lists only, and it is the counterpart to splitTopLevel NOT
 *  tracking < >. Parameters are full of generics whose commas are not separators
 *  (`params: Record<string, unknown>` is ONE parameter, not two); arguments are full
 *  of arrow functions whose `=>` would be read as a closing bracket. Tracking angles
 *  everywhere breaks arguments; tracking them nowhere breaks parameters — so each
 *  side gets the rule that fits it. Miscounting here shifts the tenant's index and
 *  reports correct call sites as offenders. */
function stripGenerics(s: string): string {
  let out = "";
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quote) {
      if (depth === 0) out += c;
      if (c === quote && s[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      if (depth === 0) out += c;
      continue;
    }
    // `=>` is not a closing angle — skip the pair so an inline callback type
    // (`onDone: () => void`) doesn't unbalance the depth.
    if (c === "=" && s[i + 1] === ">") {
      if (depth === 0) out += "=>";
      i += 1;
      continue;
    }
    if (c === "<") {
      depth += 1;
      continue;
    }
    if (c === ">" && depth > 0) {
      depth -= 1;
      continue;
    }
    if (depth === 0) out += c;
  }
  return out;
}

/** The text between the parens opening at `open`, paren-balanced. */
function argText(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "(") depth += 1;
    else if (src[i] === ")") {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return "";
}

// ---- 1. derive the tenant-defaulting store functions -----------------------
const FN = /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*(?:<[^>]*>)?\s*\(/g;
/** name -> 0-based index of the `workspaceId = DEFAULT_WORKSPACE_ID` parameter. */
const tenantArgIndex = new Map<string, number>();

for (const f of walk(libDir)) {
  const src = readFileSync(f, "utf8");
  FN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FN.exec(src))) {
    const open = src.indexOf("(", m.index + m[0].length - 1);
    const params = splitTopLevel(stripGenerics(stripComments(argText(src, open))));
    const idx = params.findIndex((p) => /^workspaceId\s*[?:]/.test(p) && /=\s*DEFAULT_WORKSPACE_ID/.test(p));
    if (idx >= 0) tenantArgIndex.set(m[1], idx);
  }
}

// ---- 2. find route-layer calls that omit it --------------------------------
type Offender = { file: string; fn: string; line: number };

function offendersIn(files: string[], root: string): Offender[] {
  const found: Offender[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const lines = src.split("\n");
    for (const [fn, idx] of tenantArgIndex) {
      const re = new RegExp(`(?<![A-Za-z0-9_.])${fn}\\s*\\(`, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const open = src.indexOf("(", m.index + fn.length - 1);
        const args = splitTopLevel(stripComments(argText(src, open)));
        const passed = args.length === 1 && args[0] === "" ? 0 : args.length;
        if (passed > idx) continue;
        const line = src.slice(0, m.index).split("\n").length;
        // Prose in this codebase documents its own past tenant bugs by name
        // ("listPostings() bare read the DEFAULT workspace") — a sentence is not a
        // call site.
        if (/^\s*(\/\/|\*|\/\*)/.test(lines[line - 1] ?? "")) continue;
        found.push({ file: path.relative(root, f).replace(/\\/g, "/"), fn, line });
      }
    }
  }
  return found;
}

// ---- 3. the allowlist ------------------------------------------------------
// Every entry is a call site that is CORRECT without a tenant, with the reason. Adding
// a line here is a deliberate act: it asserts the omission is by design, not forgotten.
// Format: "<route-relative path>::<function>".
//
// EMPTY IS THE GOAL. A genuinely global read (a heartbeat sweep, a deployment-level
// probe) belongs here; a route that simply forgot does not — fix it instead.
const ALLOWED = new Map<string, string>([
  // (populated deliberately; see the assertion message for how to add one)
]);

test("the route layer threads a tenant into every tenant-defaulting store call", () => {
  // Non-vacuity: if the derivation breaks, the scan silently passes with nothing to
  // check. Pin a floor well under the real count (~200) so it survives refactors.
  assert.ok(
    tenantArgIndex.size >= 100,
    `expected to derive the tenant-defaulting store surface, only found ${tenantArgIndex.size} functions — the scanner is broken, not the code`
  );

  const routeFiles = walk(apiDir).filter((f) => f.endsWith("route.ts"));
  assert.ok(routeFiles.length >= 50, `expected to scan the API surface, only found ${routeFiles.length} routes`);

  const offenders = offendersIn(routeFiles, apiDir);
  const unexplained = offenders
    .filter((o) => !ALLOWED.has(`${o.file}::${o.fn}`))
    .map((o) => `${o.file}:${o.line}  ${o.fn}()`)
    .sort();

  assert.deepEqual(
    unexplained,
    [],
    `These route call sites omit the workspace argument, so they read/write the DEFAULT tenant:\n` +
      `  ${unexplained.join("\n  ")}\n\n` +
      `Fix by resolving a tenant — from an entity already in scope (entry.workspaceId,\n` +
      `invite.workspaceId, sub.workspaceId), from a linked one (getEntryWorkspace), or —\n` +
      `only on a session route, never a public token route — \`await currentWorkspace()\`.\n` +
      `If the omission is genuinely correct, add it to ALLOWED in this file WITH THE REASON.`
  );
});
