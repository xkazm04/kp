// Guard: a "use client" file must never reach a server-only module through its VALUE imports.
//
// `typecheck`, `lint` and `test:unit` all stay green when a client component imports a pure-looking
// module that itself imports better-sqlite3 — a bundling boundary is not a type error, and only
// `next build` ("Can't resolve 'fs'") notices. b9f45b1aa did exactly that: IntegrationsWebhookPanel
// (client) -> ats-record.ts -> db/core.ts. This walks the same graph a bundler would.
//
// Emitted imports come from typescript's transpileModule (isolatedModules semantics, the elision SWC
// applies), so `import type` and imports used only as types do not count. A top-level "use server"
// file ends a branch: a client bundle receives a reference stub for it, not the module.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const APP = path.join(ROOT, "app");
const DB_DIR = path.join(APP, "_lib", "db") + path.sep;

const FORBIDDEN_MODULES = new Set([
  "better-sqlite3",
  "fs",
  "node:fs",
  "fs/promises",
  "node:fs/promises",
  "child_process",
  "node:child_process",
]);
const EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"];

type Import = { specifier: string; line: number };
type Parsed = { directives: string[]; imports: Import[] };

const cache = new Map<string, Parsed>();

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full);
  }
}

function directivesOf(sf: ts.SourceFile): string[] {
  const found: string[] = [];
  for (const stmt of sf.statements) {
    if (ts.isExpressionStatement(stmt) && ts.isStringLiteral(stmt.expression)) found.push(stmt.expression.text);
    else break;
  }
  return found;
}

function parse(file: string): Parsed {
  const hit = cache.get(file);
  if (hit) return hit;
  const source = readFileSync(file, "utf8");
  const kind = file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const directives = directivesOf(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, kind));
  const emitted = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.Preserve,
      isolatedModules: true,
      verbatimModuleSyntax: false,
      importsNotUsedAsValues: undefined,
    },
  }).outputText;
  const out = ts.createSourceFile(file + ".js", emitted, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text);
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === "require")) {
        specifiers.push(node.arguments[0].text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(out);
  const lines = source.split(/\r?\n/);
  const imports = specifiers.map((specifier) => {
    const idx = lines.findIndex((l) => l.includes(`"${specifier}"`) || l.includes(`'${specifier}'`));
    return { specifier, line: idx + 1 };
  });
  const parsed = { directives, imports };
  cache.set(file, parsed);
  return parsed;
}

function resolveFile(base: string): string | null {
  const tries = [base, ...EXTENSIONS.map((e) => base + e), ...EXTENSIONS.map((e) => path.join(base, "index" + e))];
  for (const t of tries) {
    if (existsSync(t) && statSync(t).isFile() && /\.(ts|tsx|mts|js|jsx|mjs)$/.test(t)) return t;
  }
  return null;
}

function resolveSpecifier(from: string, specifier: string): string | null {
  if (specifier.startsWith("@/")) return resolveFile(path.join(ROOT, specifier.slice(2)));
  if (specifier.startsWith(".")) return resolveFile(path.resolve(path.dirname(from), specifier));
  return null;
}

const rel = (f: string): string => path.relative(ROOT, f).split(path.sep).join("/");

test("no client bundle reaches better-sqlite3, fs, child_process or app/_lib/db", () => {
  const files: string[] = [];
  walk(APP, files);
  // Cheap text prefilter (comments, then the directive) so only candidate files are parsed; the AST
  // then decides, so a "use client" inside a string later in a file never counts.
  const prologue = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use client["']/;
  const clients = files.filter((f) => prologue.test(readFileSync(f, "utf8")) && parse(f).directives[0] === "use client");
  assert.ok(clients.length > 50, `expected to find the app's client components, found ${clients.length}`);

  const failures: string[] = [];
  for (const client of clients) {
    // BFS keeps each chain the shortest one; `via` records the hop's file:line for printing.
    const parent = new Map<string, { from: string; line: number; specifier: string } | null>([[client, null]]);
    const queue = [client];
    const reported = new Set<string>();
    const chainTo = (file: string, tail: string): string => {
      const hops: string[] = [];
      for (let cur: string | undefined = file; cur; ) {
        const p: { from: string; line: number; specifier: string } | null | undefined = parent.get(cur);
        if (!p) break;
        hops.unshift(`${rel(p.from)}:${p.line} imports "${p.specifier}"`);
        cur = p.from;
      }
      return [`  ${rel(client)} ("use client")`, ...hops.map((h) => `    -> ${h}`), `    => ${tail}`].join("\n");
    };
    while (queue.length) {
      const file = queue.shift() as string;
      for (const imp of parse(file).imports) {
        if (FORBIDDEN_MODULES.has(imp.specifier)) {
          const key = `module:${imp.specifier}:${file}`;
          if (reported.has(key)) continue;
          reported.add(key);
          parent.set(`${file}\0${imp.specifier}`, { from: file, line: imp.line, specifier: imp.specifier });
          failures.push(chainTo(`${file}\0${imp.specifier}`, `server-only module "${imp.specifier}"`));
          continue;
        }
        const target = resolveSpecifier(file, imp.specifier);
        if (!target || parent.has(target)) continue;
        parent.set(target, { from: file, line: imp.line, specifier: imp.specifier });
        if (parse(target).directives.includes("use server")) continue;
        if ((target + "").startsWith(DB_DIR)) {
          failures.push(chainTo(target, `${rel(target)} is under app/_lib/db/ (server-only)`));
          continue;
        }
        queue.push(target);
      }
    }
  }
  assert.equal(
    failures.length,
    0,
    `a "use client" file reaches a server-only module; \`next build\` would fail with "Can't resolve 'fs'":\n${failures.join("\n")}\n` +
      "Fix: move what the client needs into a dependency-free module (see app/_lib/slate-population.ts).",
  );
});
