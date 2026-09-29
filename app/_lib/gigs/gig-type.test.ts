// The kind of work a gig is (gig-type.ts): the keyword rules over the brief category's
// head, the arena fallback, and the knowledge resolution through a registry index.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  GIG_KNOWLEDGE_MAX,
  GIG_TYPES,
  GIG_TYPE_KNOWLEDGE,
  GIG_TYPE_LABEL,
  gigTypeFromCategory,
  gigTypeOf,
  isGigType,
} from "./gig-type.ts";
import { resolveGigTypeKnowledge, resolveKnowledgeRegistryDir } from "./gig-type-knowledge.ts";
import type { GigArena } from "./types.ts";

const TMP = mkdtempSync(path.join(tmpdir(), "kp-gig-type-"));
after(() => rmSync(TMP, { recursive: true, force: true }));

const of = (category: string | null, arena: GigArena = "freelance") => gigTypeOf({ arena, brief: category === null ? null : { category } });

test("the keyword rules read the category's FIRST segment", () => {
  assert.equal(of("Web security · Stored XSS in profile bio"), "security", "security outranks web");
  assert.equal(of("XSS · profile bio"), "security");
  assert.equal(of("Vulnerability research · auth"), "security", "a prefix rule: vuln");
  assert.equal(of("Pentesting · external"), "security");
  assert.equal(of("Web development · Typing test tool"), "web");
  assert.equal(of("Backend API · rate limits"), "web");
  assert.equal(of("Full-stack app · dashboard"), "web", "a phrase across a hyphen");
  assert.equal(of("UI/UX design · onboarding"), "ui");
  assert.equal(of("Figma · design system"), "ui");
  assert.equal(of("ML · Tabular forecasting"), "data-ml");
  assert.equal(of("Data analytics · Excel dashboard"), "data-ml");
  assert.equal(of("AI agents · automation"), "data-ml");
  assert.equal(of("System design · event bus"), "architecture", "a phrase outranks the single word 'design'");
  assert.equal(of("DevOps · CI pipeline"), "architecture");
  assert.equal(of("Copywriting · landing page"), "content");
  assert.equal(of("Technical writing · docs"), "content");
  assert.equal(of("Something else · Web security"), "other", "only the head counts; the rest is the topic");
});

test("the arena decides when the brief names nothing (or there is no brief)", () => {
  assert.equal(of(null, "security"), "security");
  assert.equal(of(null, "competition"), "data-ml");
  assert.equal(of(null, "freelance"), "other");
  assert.equal(of(null, "oss_bounty"), "other");
  assert.equal(of("Mobile apps · Swift", "competition"), "data-ml", "an unmatched head falls back to the arena");
  assert.equal(gigTypeFromCategory(""), null);
  assert.equal(gigTypeFromCategory(null), null);
});

test("the vocabulary is closed and every type has a label and a knowledge list", () => {
  for (const t of GIG_TYPES) {
    assert.ok(isGigType(t));
    assert.ok(GIG_TYPE_LABEL[t]);
    assert.ok(Array.isArray(GIG_TYPE_KNOWLEDGE[t]));
    assert.ok(GIG_TYPE_KNOWLEDGE[t].length <= GIG_KNOWLEDGE_MAX);
  }
  assert.equal(isGigType("frontend"), false);
  assert.deepEqual(GIG_TYPE_KNOWLEDGE.other, []);
});

function registry(name: string, bundles: Record<string, Record<string, { file: string }>>): string {
  const dir = path.join(TMP, name);
  for (const [bundle, subjects] of Object.entries(bundles)) {
    mkdirSync(path.join(dir, "knowledge", bundle), { recursive: true });
    writeFileSync(path.join(dir, "knowledge", bundle, "index.json"), JSON.stringify({ meta: {}, subjects, laws: [] }));
  }
  mkdirSync(path.join(dir, "knowledge"), { recursive: true });
  return dir;
}

test("knowledge resolves each subject's file through its bundle index; an unknown subject is dropped", () => {
  const dir = registry("reg-a", {
    "software-engineering": {
      authorization: { file: "knowledge/software-engineering/security/identity-and-access/authorization/authorization.md" },
      "supply-chain": { file: "knowledge/software-engineering/security/code-provenance/supply-chain/supply-chain.md" },
      // browser-credential-boundary deliberately absent
    },
  });
  const refs = resolveGigTypeKnowledge("security", { registryDir: dir });
  assert.deepEqual(refs, [
    { bundle: "software-engineering", subject: "authorization", path: "knowledge/software-engineering/security/identity-and-access/authorization/authorization.md" },
    { bundle: "software-engineering", subject: "supply-chain", path: "knowledge/software-engineering/security/code-provenance/supply-chain/supply-chain.md" },
  ]);
  assert.deepEqual(resolveGigTypeKnowledge("content", { registryDir: dir }), [], "no marketing index: its subjects are dropped");
  assert.deepEqual(resolveGigTypeKnowledge("security", { registryDir: null }), [], "no registry: nothing, never a guessed path");
  assert.deepEqual(resolveGigTypeKnowledge("other", { registryDir: dir }), []);
});

test("an index file that escapes the checkout is dropped", () => {
  const dir = registry("reg-b", { "software-engineering": { "error-handling": { file: "../../etc/passwd" }, "data-access": { file: "knowledge/x/data-access.md" } } });
  assert.deepEqual(resolveGigTypeKnowledge("web", { registryDir: dir }).map((k) => k.subject), ["data-access"]);
});

test("the registry dir follows AI_REGISTRY_DIR, else the manifest, else ../ai-registry", () => {
  const dir = registry("reg-c", {});
  assert.equal(resolveKnowledgeRegistryDir({ repoRoot: path.join(TMP, "repo"), env: { AI_REGISTRY_DIR: dir } }), dir);
  assert.equal(resolveKnowledgeRegistryDir({ repoRoot: path.join(TMP, "repo"), env: { AI_REGISTRY_DIR: path.join(TMP, "nope") } }), null);
  mkdirSync(path.join(TMP, "ai-registry", "knowledge"), { recursive: true });
  assert.equal(resolveKnowledgeRegistryDir({ repoRoot: path.join(TMP, "repo"), env: {} }), path.join(TMP, "ai-registry"));
});
