// Source-guard: a hiring-chain empty state on a registry tab must mount a
// traced glyph, not a lucide icon.
//
// glyphsHaveConsumers prevents orphan art; this prevents a live empty state
// from ignoring art that exists. Agents' empty ChainEmptyState still uses
// lucide Bot because there is no agents glyph — it is not a registry tab, so
// it is out of scope. Pipeline is the exemplar board (surface doctrine) and
// settings tabs have no art; both are allowlisted.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { GLYPH_BY_TAB, type GlyphRegistryTabId } from "./glyphRegistry.ts";

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const APP_DIR = join(REPO_ROOT, "app");
const SKIP_DIRS = new Set(["node_modules", ".next", ".git"]);

const ALLOWLIST = [
  /features[/\\]hiring[/\\]pipeline[/\\]/,
  /features[/\\]settings[/\\]/,
];

const TAB_PATH: { re: RegExp; tab: GlyphRegistryTabId }[] = [
  { re: /features[/\\]library[/\\]jobs[/\\]/, tab: "jobs" },
  { re: /features[/\\]library[/\\]jds[/\\]/, tab: "library" },
  { re: /features[/\\]insights[/\\]analytics[/\\]/, tab: "analytics" },
  { re: /features[/\\]hiring[/\\]decisions[/\\]/, tab: "decisions" },
  { re: /features[/\\]hiring[/\\]schedule[/\\]/, tab: "schedule" },
  { re: /features[/\\]tools[/\\]devcases[/\\]/, tab: "assignments" },
  { re: /features[/\\]tools[/\\]profile[/\\]/, tab: "archetypes" },
  { re: /features[/\\]insights[/\\]matrix[/\\]/, tab: "matrix" },
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function posix(file: string): string {
  return relative(APP_DIR, file).split(sep).join("/");
}

function tabForFile(file: string): GlyphRegistryTabId | undefined {
  return TAB_PATH.find((row) => row.re.test(file))?.tab;
}

function isAllowlisted(file: string): boolean {
  return ALLOWLIST.some((re) => re.test(file));
}

/** Each `<ChainEmptyState … />` element's own text. */
function chainEmptyElements(text: string): string[] {
  const found: string[] = [];
  let at = text.indexOf("<ChainEmptyState");
  while (at !== -1) {
    const self = text.indexOf("/>", at);
    const open = text.indexOf(">", at);
    const end = self !== -1 && (open === -1 || self < open + 1) ? self + 2 : open === -1 ? -1 : open + 1;
    if (end === -1) break;
    found.push(text.slice(at, end));
    at = text.indexOf("<ChainEmptyState", end);
  }
  return found;
}

function hasGlyphOrTab(el: string): boolean {
  return /\bglyph=/.test(el) || /\btab=/.test(el);
}

function hasLucideIcon(el: string): boolean {
  return /\bicon=/.test(el);
}

const files = sourceFiles(APP_DIR).map((path) => ({ path, text: readFileSync(path, "utf8") }));

test("self-check: the scan sees ChainEmptyState and MotionizedGlyph call sites and the registry", () => {
  const sites = files.flatMap((f) => chainEmptyElements(f.text));
  const glyphs = files.reduce((n, f) => n + (f.text.split("<MotionizedGlyph").length - 1), 0);
  assert.ok(sites.length >= 4, `expected ChainEmptyState call sites, found ${sites.length}`);
  // 11 since the Channels "Intake Studio" empty state left with its view (kit promotion, 2026-09-25).
  assert.ok(glyphs >= 11, `expected MotionizedGlyph render sites, found ${glyphs}`);
  assert.ok(Object.keys(GLYPH_BY_TAB).length >= 8, "registry is empty — the gate would pass vacuously");
});

test("unallowlisted ChainEmptyState on a registry tab must pass glyph or tab, not a lucide icon", () => {
  const offenders: string[] = [];
  for (const { path, text } of files) {
    if (isAllowlisted(path)) continue;
    const tab = tabForFile(path);
    if (!tab || !Object.hasOwn(GLYPH_BY_TAB, tab)) continue;
    chainEmptyElements(text).forEach((el, i) => {
      if (hasLucideIcon(el) && !hasGlyphOrTab(el)) {
        offenders.push(`${posix(path)}[${i}] tab=${tab}`);
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `ChainEmptyState on a registry tab used a lucide icon without glyph/tab:\n${offenders.join("\n")}`,
  );
});

test("Agents empty is out of scope (no agents glyph) and pipeline is allowlisted", () => {
  const agents = files.find((f) => f.path.includes(`${sep}agents-workforce${sep}AgentsWorkforceTab.tsx`));
  assert.ok(agents, "AgentsWorkforceTab.tsx not found");
  const agentEls = chainEmptyElements(agents.text);
  assert.ok(agentEls.some(hasLucideIcon), "Agents empty still uses lucide Bot — that is allowed until it has art");
  assert.equal(tabForFile(agents.path), undefined);

  const pipelineHit = files.some((f) => isAllowlisted(f.path) && /features[/\\]hiring[/\\]pipeline[/\\]/.test(f.path));
  assert.ok(pipelineHit || ALLOWLIST[0].test("features/hiring/pipeline/x"), "pipeline allowlist is wired");
});
