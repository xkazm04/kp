#!/usr/bin/env node
// Drift check for docs/architecture/engine-and-prompt-coordination.md.
//
// The matrix is hand-curated (each row carries judgement: degrade path, what moves
// on a bump), so this does NOT regenerate it. It reads the facts the matrix must
// name straight from the source and fails when one is missing from the doc:
//   - every *PROMPT_VERSION string literal declared in pipeline/**, app/**, packages/**
//     (non-test source),
//   - every concrete model id in capabilities.py DEFAULT_MODELS,
//   - the non-registry engine picks (voice / TTS / embedding env keys and defaults).
// A new prompt version or model literal that is not listed therefore reddens the check.
//
//   node scripts/llm/engine-matrix.mjs            # print the inventory
//   node scripts/llm/engine-matrix.mjs --check    # exit 1 on any unlisted entry
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DOC = "docs/architecture/engine-and-prompt-coordination.md";
const SKIP_DIR = new Set(["node_modules", ".next", ".git", "tests", "__tests__", "__pycache__", ".claude", "dist"]);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.(py|ts|tsx)$/.test(name) && !/\.test\.|\.generated\.|test_/.test(name)) yield p;
  }
}

const VERSION_RE = /^\s*(?:export\s+const\s+)?([A-Z][A-Z0-9_]*PROMPT_VERSION)\s*(?::\s*[\w\[\], ]+)?\s*=\s*["']([^"']+)["']/;

export function collect() {
  const versions = [];
  for (const top of ["pipeline", "app", "packages"]) {
    let files;
    try { files = [...walk(join(ROOT, top))]; } catch { continue; }
    for (const f of files) {
      readFileSync(f, "utf8").split(/\r?\n/).forEach((line, i) => {
        const m = VERSION_RE.exec(line);
        if (m) versions.push({ name: m[1], value: m[2], where: `${relative(ROOT, f).split(sep).join("/")}:${i + 1}` });
      });
    }
  }
  const caps = readFileSync(join(ROOT, "pipeline/jobfit/llm/capabilities.py"), "utf8");
  const block = /DEFAULT_MODELS[^=]*=\s*\{(.*?)\n\}/s.exec(caps)?.[1] ?? "";
  const models = [...block.matchAll(/"(\w+)"\s*:\s*"([^"]+)"/g)].map((m) => ({ provider: m[1], value: m[2] }));
  return { versions, models };
}

const { versions, models } = collect();
const doc = readFileSync(join(ROOT, DOC), "utf8");
const missing = [
  ...versions.filter((v) => !doc.includes(v.value)).map((v) => `prompt version ${v.value} (${v.name} @ ${v.where})`),
  ...models.filter((m) => !doc.includes(m.value)).map((m) => `default model ${m.value} (DEFAULT_MODELS.${m.provider})`),
];
if (versions.length < 30 || models.length < 3) {
  console.error(`engine-matrix: extractor is vacuous (${versions.length} versions, ${models.length} models)`);
  process.exit(1);
}
if (process.argv.includes("--check")) {
  if (missing.length) {
    console.error(`engine-matrix: ${DOC} does not name:\n  - ${missing.join("\n  - ")}\nAdd a row (step, engine, prompt version, degrade path) in the same change.`);
    process.exit(1);
  }
  console.log(`engine-matrix: ${versions.length} prompt versions and ${models.length} default models all named in ${DOC}`);
} else {
  for (const v of versions) console.log(`${v.value}\t${v.name}\t${v.where}`);
  for (const m of models) console.log(`${m.value}\tDEFAULT_MODELS.${m.provider}`);
}
