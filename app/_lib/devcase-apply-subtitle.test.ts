import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { applySubtitleKey, caseRoleFamily, chatIntroKey, doorRegister, workIntroKey } from "./devcase-apply-subtitle.ts";
import { devcaseAssistantLive } from "./devcase-assistant-live.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOCALES = ["en", "cs", "de", "fr"] as const;

test("live-work (has seed) uses subtitleLive; repo-link uses subtitleRepo", () => {
  assert.equal(applySubtitleKey(true), "subtitleLive");
  assert.equal(applySubtitleKey(false), "subtitleRepo");
});

test("the apply page renders the helper's key, not a single subtitle", () => {
  const src = readFileSync(path.join(ROOT, "app", "devcase", "apply", "[token]", "page.tsx"), "utf8");
  assert.match(src, /applySubtitleKey\(seedFiles\.length > 0\)/);
  assert.doesNotMatch(src, /t\("subtitle"\)/);
});

test("subtitleLive and subtitleRepo exist in all four catalogs", () => {
  for (const locale of LOCALES) {
    const cat = JSON.parse(readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8")) as {
      devApply?: { subtitleLive?: string; subtitleRepo?: string };
    };
    assert.ok(cat.devApply?.subtitleLive?.trim(), `messages/${locale}.json devApply.subtitleLive`);
    assert.ok(cat.devApply?.subtitleRepo?.trim(), `messages/${locale}.json devApply.subtitleRepo`);
  }
});

// ── CX S43: the door speaks the case's register and says when no AI is behind it ──────

test("a software case keeps the developer wording; a sales or ops case reads role-neutral", () => {
  assert.equal(caseRoleFamily({ roleFamily: "sales" }, { roleFamily: "software_engineering" }), "sales", "the need wins");
  assert.equal(caseRoleFamily(null, { roleFamily: "operations" }), "operations");
  assert.equal(caseRoleFamily(null, null), null);
  assert.equal(workIntroKey(doorRegister("software_engineering")), "intro");
  assert.equal(workIntroKey(doorRegister("data_ai")), "intro");
  assert.equal(workIntroKey(doorRegister(null)), "intro", "unclassified = the design chain's recorded default");
  assert.equal(workIntroKey(doorRegister("sales")), "introGeneral");
});

test("the general intro never says code, and every path says AI is allowed", () => {
  for (const locale of LOCALES) {
    const cat = JSON.parse(readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8"));
    const general: string = cat.devApply.workSurface.introGeneral;
    assert.doesNotMatch(general, /code|kód/i, `${locale}: introGeneral is role-neutral`);
    assert.ok(cat.devApply.aiAllowed, `${locale}: the repository-link path carries the AI-allowed line`);
    assert.ok(cat.devApply.workSurface.chatIntroStandIn, `${locale}: the stand-in intro exists`);
  }
  const page = readFileSync(path.join(ROOT, "app", "devcase", "apply", "[token]", "page.tsx"), "utf8");
  assert.match(page, /t\("aiAllowed"\)/, "the repo-link section renders it");
});

test("no real AI behind the tabs: the intro says so and stops promising that prompts count", () => {
  assert.equal(chatIntroKey(true, false), "chatIntro");
  assert.equal(chatIntroKey(false, false), "chatIntroStandIn");
  assert.equal(chatIntroKey(true, true), "chatIntroStandIn", "a scripted reply overrules the forecast");
  for (const locale of LOCALES) {
    const cat = JSON.parse(readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8"));
    const standIn: string = cat.devApply.workSurface.chatIntroStandIn;
    const live: string = cat.devApply.workSurface.chatIntro;
    assert.notEqual(standIn, live, `${locale}: the stand-in copy is its own sentence`);
  }
});

test("the assistant forecast: offline is never live; configured or an engine on PATH is", () => {
  const off = { claudeCli: false, gemini: false };
  assert.equal(devcaseAssistantLive({ offline: () => true, configured: () => true, engine: () => ({ claudeCli: true, gemini: true }) }), false);
  assert.equal(devcaseAssistantLive({ offline: () => false, configured: () => true, engine: () => off }), true);
  assert.equal(devcaseAssistantLive({ offline: () => false, configured: () => false, engine: () => ({ claudeCli: true, gemini: false }) }), true);
  assert.equal(devcaseAssistantLive({ offline: () => false, configured: () => false, engine: () => off }), false);
  assert.equal(
    devcaseAssistantLive({ offline: () => false, configured: () => { throw new Error("store"); }, engine: () => off }),
    false,
    "an unreadable config store falls through to the engine probe"
  );
});
