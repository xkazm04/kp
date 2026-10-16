// One-shot codemod behind the withWorkspace migration (ADR draft-route-chain-refusal-order).
// Usage: node --experimental-strip-types scripts/codemod/wrap-with-workspace.mjs <api-path-prefix>... [--dry]
// Rewrites every exported HTTP handler of each non-public route.ts under the prefixes:
//   export async function GET(request) { const ws = await currentWorkspace(); ... }
// into
//   export const GET = withWorkspace(async (ws: string, request) => { ... });
// A handler that never resolved a workspace gets an unused `_ws` so the whole file is
// uniformly behind the session gate. Files it cannot rewrite safely are reported, not guessed.
import ts from "typescript";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { isPublicPath } from "../../app/_lib/auth/public-routes.ts";

const API = path.resolve("app/api");
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const args = process.argv.slice(2);
const dry = args.includes("--dry");
const prefixes = args.filter((a) => !a.startsWith("--"));


function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (n === "route.ts") out.push(p);
  }
  return out;
}
const rel = (f) => path.relative(API, f).split(path.sep).join("/");
const urlOf = (f) => "/api/" + rel(f).replace(/\/?route\.ts$/, "");

const isCwCall = (n) => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "currentWorkspace" && n.arguments.length === 0;
const isAwaitCw = (n) => ts.isAwaitExpression(n) && isCwCall(n.expression);

const files = walk(API).filter((f) => prefixes.some((p) => rel(f).startsWith(p)));
let changed = 0;
const skipped = [];
for (const file of files) {
  const url = urlOf(file);
  if (isPublicPath(url)) continue;
  const src = readFileSync(file, "utf8");
  if (src.includes("workspace-context")) continue;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const edits = [];
  const wrappersUsed = new Set();
  let bail = null;
  const handlers = sf.statements.filter(
    (s) => ts.isFunctionDeclaration(s) && s.name && METHODS.has(s.name.text) && s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) && s.body,
  );
  if (!handlers.length) { skipped.push([url, "no exported function handlers"]); continue; }
  for (const fn of handlers) {
    const decls = [];
    const inlines = [];
    const pairs = [];
    (function visit(n) {
      if (ts.isVariableStatement(n) && n.declarationList.declarations.length === 1) {
        const d = n.declarationList.declarations[0];
        if (ts.isIdentifier(d.name) && d.initializer && isAwaitCw(d.initializer) && !d.type) { decls.push({ stmt: n, name: d.name.text }); return; }
        if (ts.isArrayBindingPattern(d.name) && d.initializer && ts.isAwaitExpression(d.initializer) && ts.isCallExpression(d.initializer.expression)) {
          const c = d.initializer.expression;
          if (ts.isPropertyAccessExpression(c.expression) && c.expression.getText() === "Promise.all" && c.arguments.length === 1 && ts.isArrayLiteralExpression(c.arguments[0])) {
            const els = c.arguments[0].elements;
            const bs = d.name.elements;
            if (els.length === 2 && bs.length === 2 && bs.every((b) => ts.isBindingElement(b) && ts.isIdentifier(b.name))) {
              const ci = els.findIndex(isCwCall);
              if (ci >= 0) {
                pairs.push({ stmt: n, ci, name: bs[ci].name.text, other: els[1 - ci], otherName: bs[1 - ci].name.text, kind: n.declarationList.flags & ts.NodeFlags.Const ? "const" : "let" });
                return;
              }
            }
          }
        }
      }
      if (isAwaitCw(n)) { inlines.push(n); return; }
      if (isCwCall(n)) { bail = "currentWorkspace() without await"; return; }
      ts.forEachChild(n, visit);
    })(fn.body);
    if (bail) { skipped.push([url, bail]); break; }
    const names = [...new Set([...decls.map((d) => d.name), ...pairs.map((p) => p.name)])];
    const used = decls.length + pairs.length + inlines.length > 0;
    let N = names[0];
    if (used && !N) {
      const bodyText = fn.body.getText();
      N = ["ws", "workspaceId", "reqWorkspace"].find((c) => !new RegExp("\\b" + c + "\\b").test(bodyText));
      if (!N) { skipped.push([url, fn.name.text + ": no free name"]); bail = "x"; break; }
    }
    const wrapper = used ? "withWorkspace" : "withSession";
    wrappersUsed.add(wrapper);
    for (const d of decls) {
      const e = d.stmt.getEnd();
      if (d.name === N) {
        // Remove the whole line (indent + statement + newline); a leading comment stays.
        let s = d.stmt.getStart();
        while (s > 0 && (src[s - 1] === " " || src[s - 1] === "\t")) s--;
        let e2 = e;
        if (src[e2] === "\r") e2++;
        if (src[e2] === "\n") e2++;
        edits.push({ start: s, end: e2, text: "" });
      } else {
        edits.push({ start: d.stmt.getStart(), end: e, text: "const " + d.name + " = " + N + ";" });
      }
    }
    for (const p of pairs) {
      let rep = p.kind + " " + p.otherName + " = await " + p.other.getText() + ";";
      if (p.name !== N) rep += "\n  const " + p.name + " = " + N + ";";
      edits.push({ start: p.stmt.getStart(), end: p.stmt.getEnd(), text: rep });
    }
    for (const i of inlines) edits.push({ start: i.getStart(), end: i.getEnd(), text: N });
    const paramText = [...(used ? [N + ": string"] : []), ...fn.parameters.map((p) => p.getText())].join(", ");
    const ret = fn.type ? ": " + fn.type.getText() : "";
    const isAsync = fn.modifiers.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
    const head = "export const " + fn.name.text + " = " + wrapper + "(" + (isAsync ? "async " : "") + "(" + paramText + ")" + ret + " => ";
    edits.push({ start: fn.getStart(), end: fn.body.getStart(), text: head });
    edits.push({ start: fn.body.getEnd(), end: fn.body.getEnd(), text: ");" });
  }
  if (bail) continue;
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = src;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  const IMPORT_LINE = "import { " + [...wrappersUsed].sort().join(", ") + ' } from "@/app/_lib/auth/workspace-context";';
  // Imports: swap the resolver import when nothing else uses it, else add ours.
  const resolverImport = /import\s*\{\s*currentWorkspace\s*\}\s*from\s*"[^"]+";?(\r?\n)/;
  // Identifier uses only (a mention in a comment must not keep the import alive).
  let stillUses = false;
  (function scan(n) {
    if (ts.isImportDeclaration(n)) return;
    if (ts.isIdentifier(n) && n.text === "currentWorkspace") stillUses = true;
    ts.forEachChild(n, scan);
  })(ts.createSourceFile(file, out, ts.ScriptTarget.Latest, true));
  if (!stillUses && resolverImport.test(out)) {
    out = out.replace(resolverImport, IMPORT_LINE + "$1");
  } else {
    const sf2 = ts.createSourceFile(file, out, ts.ScriptTarget.Latest, true);
    const imps = sf2.statements.filter(ts.isImportDeclaration);
    const at = imps.length ? imps[imps.length - 1].getEnd() : 0;
    out = out.slice(0, at) + "\n" + IMPORT_LINE + out.slice(at);
  }
  if (!dry) writeFileSync(file, out);
  changed++;
}
console.log((dry ? "[dry] " : "") + "changed " + changed + " files");
for (const [u, r] of skipped) console.log("SKIP", u, "-", r);
