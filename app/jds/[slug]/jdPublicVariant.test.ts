// Pins which language variant of the public JD page is served, and what the page
// advertises: an explicit ?lang= with a FRESH stored translation from the OWNER team
// is served whole and disclosed; every other request serves the whole original.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  loadPublicJdLanguages,
  publicJdServedView,
  resolvePublicJdVariant,
  servablePublicJdTranslations,
  type StoredJdTranslation,
} from "./jdPublicVariant.ts";
import { publicJdAlternates } from "./jdPublicHeader.ts";

const LAST_EDITED = "2026-09-10T10:00:00.000Z";
const CS_FRESH: StoredJdTranslation = {
  lang: "cs",
  sourceLang: "en",
  title: "Backend inženýr",
  bodyMd: "## O roli\nČeský text inzerátu.",
  createdAt: "2026-09-12T08:00:00.000Z",
};
const CS_STALE: StoredJdTranslation = { ...CS_FRESH, createdAt: "2026-09-01T08:00:00.000Z" };

test("1. an explicit ?lang=cs with a fresh owner translation serves it whole", () => {
  const variant = resolvePublicJdVariant({
    requested: "cs",
    sourceLang: "en",
    translations: [CS_FRESH],
    lastEditedAt: LAST_EDITED,
    archived: false,
  });
  assert.deepEqual(variant, {
    kind: "translated",
    lang: "cs",
    body: CS_FRESH.bodyMd,
    title: CS_FRESH.title,
    fromLang: "en",
  });
  // A regional tag folds onto the shipped catalog like the proxy does (?lang=cs-CZ).
  assert.equal(
    resolvePublicJdVariant({ requested: "cs-CZ", sourceLang: "en", translations: [CS_FRESH], lastEditedAt: LAST_EDITED, archived: false }).kind,
    "translated"
  );
});

test("2. a requested language with nothing stored serves the whole original", () => {
  for (const requested of ["de", "en", undefined, null, "", "xx", ["de", "cs"]]) {
    const variant = resolvePublicJdVariant({
      requested,
      sourceLang: "en",
      translations: [CS_FRESH],
      lastEditedAt: LAST_EDITED,
      archived: false,
    });
    assert.deepEqual(variant, { kind: "canonical" }, `requested=${JSON.stringify(requested)}`);
  }
});

test("3. a translation older than the JD's last edit is neither served nor advertised", () => {
  const input = { sourceLang: "en", translations: [CS_STALE], lastEditedAt: LAST_EDITED, archived: false };
  assert.deepEqual(resolvePublicJdVariant({ ...input, requested: "cs" }), { kind: "canonical" });
  const served = servablePublicJdTranslations(input).map((t) => t.lang);
  assert.deepEqual(served, []);
  const alt = publicJdAlternates("backend", { archived: false, sourceLang: "en", servedLangs: served, requested: "cs" });
  assert.equal("cs" in alt.languages, false);
  // Never edited (no revision rows): every stored translation is fresh.
  assert.deepEqual(
    servablePublicJdTranslations({ ...input, lastEditedAt: null }).map((t) => t.lang),
    ["cs"]
  );
});

test("4. alternates list the source + fresh translations + x-default, each variant self-canonical", () => {
  const served = servablePublicJdTranslations({
    sourceLang: "en",
    translations: [CS_FRESH, { ...CS_FRESH, lang: "de" }, { ...CS_FRESH, lang: "en" }],
    lastEditedAt: LAST_EDITED,
    archived: false,
  }).map((t) => t.lang);
  assert.deepEqual(served, ["cs", "de"]);

  const cs = publicJdAlternates("backend", { archived: false, sourceLang: "en", servedLangs: served, requested: "cs" });
  assert.deepEqual(cs.languages, {
    en: "/jds/backend?lang=en",
    cs: "/jds/backend?lang=cs",
    de: "/jds/backend?lang=de",
    "x-default": "/jds/backend",
  });
  assert.equal(cs.canonical, "/jds/backend?lang=cs");
  assert.equal(
    publicJdAlternates("backend", { archived: false, sourceLang: "en", servedLangs: served, requested: "en" }).canonical,
    "/jds/backend?lang=en"
  );
  // The bare URL and an unserved ?lang= both point at the original.
  assert.equal(publicJdAlternates("backend", { archived: false, sourceLang: "en", servedLangs: served, requested: null }).canonical, "/jds/backend");
  assert.equal(publicJdAlternates("backend", { archived: false, sourceLang: "en", servedLangs: served, requested: "fr" }).canonical, "/jds/backend");

  // Keyless install: nothing was ever rendered, so only the source + x-default.
  const keyless = publicJdAlternates("backend", { archived: false, sourceLang: "en", servedLangs: [], requested: "de" });
  assert.deepEqual(keyless.languages, { en: "/jds/backend?lang=en", "x-default": "/jds/backend" });
  assert.equal(keyless.canonical, "/jds/backend");
});

test("5. an archived JD sets its own empty alternates (overriding the root layout's four) and serves the original", () => {
  const input = { sourceLang: "en", translations: [CS_FRESH], lastEditedAt: LAST_EDITED, archived: true };
  assert.deepEqual(resolvePublicJdVariant({ ...input, requested: "cs" }), { kind: "canonical" });
  assert.deepEqual(servablePublicJdTranslations(input), []);
  const alt = publicJdAlternates("backend", { archived: true, sourceLang: "en", servedLangs: ["cs"], requested: "cs" });
  // Explicit, not undefined: Next merges metadata SHALLOWLY, so an omitted key would
  // inherit app/layout.tsx's four ./?lang= alternates.
  assert.deepEqual(alt, { canonical: "/jds/backend", languages: {} });

  const src = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
  const meta = src.slice(src.indexOf("export async function generateMetadata"), src.indexOf("export const instant"));
  assert.match(meta, /searchParams/, "generateMetadata must read ?lang= from searchParams");
  assert.match(meta, /loadPublicJd\(slug\)/, "generateMetadata resolves the owner through loadPublicJd");
  assert.match(meta, /loadPublicJdLanguages\([^)]*owner/, "generateMetadata reads languages with the owner team");
  assert.match(meta, /alternates:\s*publicJdAlternates\(/, "alternates are always set by the page, never inherited");
});

test("6. translations are read with the OWNER team, and the projection carries no store fields", () => {
  const calls: string[] = [];
  const byTeam: Record<string, StoredJdTranslation[]> = {
    "team-a": [CS_FRESH],
    "team-b": [{ ...CS_FRESH, lang: "de", title: "Team B only" }],
  };
  const reads = {
    translations: (jobId: string, ws: string) => {
      calls.push(`translations:${jobId}:${ws}`);
      return byTeam[ws] ?? [];
    },
    lastEditedAt: (slug: string, ws: string) => {
      calls.push(`lastEditedAt:${slug}:${ws}`);
      return LAST_EDITED;
    },
    sourceLang: (jobId: string, ws: string) => {
      calls.push(`sourceLang:${jobId}:${ws}`);
      return "en";
    },
  };
  const langs = loadPublicJdLanguages({ slug: "backend", owner: "team-a", archived: false }, reads);
  assert.deepEqual(calls, ["translations:jd-backend:team-a", "lastEditedAt:backend:team-a", "sourceLang:jd-backend:team-a"]);
  assert.deepEqual(langs.translations.map((t) => t.lang), ["cs"], "team B's de rendering never reaches team A's page");
  assert.equal(langs.sourceLang, "en");
  for (const t of langs.translations) {
    assert.deepEqual(Object.keys(t).sort(), ["bodyMd", "lang", "sourceLang", "title"]);
  }
  // A store fault degrades to the original, never an error page.
  const broken = loadPublicJdLanguages(
    { slug: "backend", owner: "team-a", archived: false },
    { ...reads, translations: () => { throw new Error("SQLITE_BUSY"); } }
  );
  assert.deepEqual(broken.translations, []);

  const src = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("export default async function JdDetailPage"));
  assert.match(body, /loadPublicJdLanguages\([^)]*owner/, "the page reads languages with loadPublicJd's owner");
  assert.doesNotMatch(src, /listJobTranslations\([^)]*currentWorkspace/, "never the viewer's team");
});

test("7. a translated variant is disclosed, links the original, hides operator tools, copies what is served", () => {
  const jd = { title: "Backend Engineer", body: "## About\nEnglish original." };
  const translated = publicJdServedView({
    slug: "backend eng",
    jd,
    canManage: true,
    variant: { kind: "translated", lang: "cs", title: CS_FRESH.title, body: CS_FRESH.bodyMd, fromLang: "en" },
  });
  assert.deepEqual(translated, {
    title: CS_FRESH.title,
    body: CS_FRESH.bodyMd,
    bodyLang: "cs",
    showActions: false,
    disclosure: { fromLang: "en", originalHref: "/jds/backend%20eng" },
  });
  const canonical = publicJdServedView({ slug: "backend eng", jd, canManage: true, variant: { kind: "canonical" } });
  assert.deepEqual(canonical, { title: jd.title, body: jd.body, bodyLang: undefined, showActions: true, disclosure: null });
  assert.equal(publicJdServedView({ slug: "x", jd, canManage: false, variant: { kind: "canonical" } }).showActions, false);

  const src = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
  assert.match(src, /<JdBody markdown=\{view\.body\}/, "the copy button copies the body actually served");
  assert.match(src, /view\.showActions \?/, "JdActions mount only when the served view allows it");
  assert.match(src, /view\.disclosure \?/, "the machine-translation note renders from the view");

  const keys = ["translatedNotice", "translatedDetail", "readOriginal", "translatedRegion"];
  for (const loc of ["en", "cs", "de", "fr"]) {
    const catalog = JSON.parse(readFileSync(new URL(`../../../messages/${loc}.json`, import.meta.url), "utf8")) as {
      jdPublic: Record<string, string>;
    };
    for (const key of keys) {
      assert.equal(typeof catalog.jdPublic[key], "string", `${loc}: jdPublic.${key}`);
    }
    assert.match(catalog.jdPublic.translatedNotice, /\{language\}/, `${loc}: translatedNotice names the source language`);
  }
});
