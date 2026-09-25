#!/usr/bin/env node
// The style ratchet at edit time — advisory, one file, under a second.
//
// `app/_components/ui/style-debt.test.ts` holds nine raw style steps to per-file
// ceilings, but it speaks at `npm run test:unit`, long after the line was typed.
// This runs the SAME matchers (style-debt-rules.ts — one definition, so the hook
// can never disagree with the gate) on the one file just edited, and prints only
// the rules where the file now sits ABOVE its ceiling in style-debt.json: the
// hits the gate will call `grew` or `undeclared`. Silence means the file is at or
// under every ceiling.
//
// Two ways in:
//   node scripts/style/lint-edited.mjs <file> [...]   plain text, for a human
//   PostToolUse hook (Edit|Write|MultiEdit)           reads the hook JSON on stdin,
//        answers with `hookSpecificOutput.additionalContext` so the agent reads it
//
// ALWAYS EXITS 0. It is advice, not a gate — the gate is the unit test. A crash
// here must never block an edit, so every failure is swallowed into silence.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const APP_DIR = path.join(ROOT, "app");

async function report(file) {
  const abs = path.resolve(ROOT, file);
  const rel = path.relative(APP_DIR, abs).split(path.sep).join("/");
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const { isStyleScoped, measureSource, STYLE_REMEDY, STYLE_RULES } = await import("../../app/_components/ui/style-debt-rules.ts");
  if (!isStyleScoped(rel)) return null;
  const { counts, lines } = measureSource(readFileSync(abs, "utf8"), rel);
  const debt = JSON.parse(readFileSync(path.join(APP_DIR, "_components/ui/style-debt.json"), "utf8"));
  const ceiling = debt.ceilings[rel] ?? {};
  const out = [];
  for (const rule of STYLE_RULES) {
    const n = counts[rule] ?? 0;
    const max = ceiling[rule] ?? 0;
    if (n <= max) continue;
    const at = [...new Set(lines[rule] ?? [])].slice(0, 12).join(",");
    out.push(`  ${rule} ${n} > ceiling ${max} (lines ${at}) — ${STYLE_REMEDY[rule]}`);
  }
  if (out.length === 0) return null;
  return `style ratchet: app/${rel} is above its ceiling in style-debt.json (npm run test:unit will fail):\n${out.join("\n")}\nRules: .claude/rules/ui.md`;
}

async function readStdin() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    for (const f of args) {
      const r = await report(f);
      if (r) console.log(r);
    }
    return;
  }
  const input = JSON.parse((await readStdin()) || "{}");
  const file = input?.tool_input?.file_path;
  if (typeof file !== "string" || !file.endsWith(".tsx")) return;
  const r = await report(file);
  if (r) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: r } }));
  }
}

main()
  .catch(() => {})
  .finally(() => {
    process.exitCode = 0;
  });
