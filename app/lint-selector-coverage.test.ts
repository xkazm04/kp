// LINT-CONFIG COVERAGE GUARD — the gate that watches the gates.
//
// WHAT THIS EXISTS TO CATCH, because it already happened once. `eslint.config.mjs`
// carries five groups of `no-restricted-syntax` selectors — the design law, the
// better-sqlite3 transaction law, the db-barrel cost law, "nobody imports a route
// handler", "the ui layer does not value-import a store", "packages/ does not
// import app/". Flat config does NOT merge a rule's options: the LAST block
// matching a file replaces them wholesale. So every group has to be carried into
// every later block that matches the same files — which is why eslint.config.mjs
// builds every block's options through `restrict()` from declared selector sets
// instead of hand-listing them (see the header note there).
//
// The four DESIGN selectors were never restated. From the moment the second
// `no-restricted-syntax` block landed they applied to nothing, and `npm run lint`
// stopped seeing a hardcoded color anywhere under app/ — silently, with the gate
// green, for as long as it took someone to probe it. `scripts/design/
// check-design-tokens.mjs` meanwhile told readers that half of the design law
// "is an eslint rule in eslint.config.mjs, so it rides `npm run lint`".
//
// Reviving the selectors fixes that instance. This fixes the CLASS: the next
// block someone appends can shadow any of the five the same way, and nothing in
// the config's own text can tell you whether it did.
//
// WHY IT READS THE RESOLVED CONFIG, not the source. A test that greps
// eslint.config.mjs for a selector string would have PASSED throughout the whole
// period the rule was dead — the text was right there, in a block that no longer
// won. `ESLint#calculateConfigForFile()` returns what eslint will actually apply
// to that path, which is the thing being gated (_laws: gate-sees-target). This is
// the same reason app/api/route-tenancy-coverage.test.ts derives its facts from
// the source tree instead of trusting a manifest.
//
// Runner: node:test with type stripping, via `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { execFileSync } from "node:child_process";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** A distinctive fragment of each selector group's own message. Matching on the
 *  message rather than the selector string keeps this readable and keeps it
 *  pinned to the thing a developer actually sees when the rule fires. */
const GROUP = {
  design_hex: "Hardcoded color.",
  design_hex_template: "Hardcoded color in a template literal.",
  design_rgba: "Inline rgb()/rgba() color.",
  design_rgba_template: "Inline rgb()/rgba() color in a template literal.",
  transaction_async_cb: "async callback passed to db.transaction()",
  transaction_await: "await inside db.transaction()",
  transaction_for_await: "for-await inside db.transaction()",
  db_barrel: "value import of the @/app/_lib/db barrel",
  no_route_import: "import of an API route handler",
  ui_no_db: "value import of a db store from a UI module",
  portable_no_app: "portable-lane module importing from app/",
} as const;

type Group = keyof typeof GROUP;

const DESIGN: Group[] = ["design_hex", "design_hex_template", "design_rgba", "design_rgba_template"];
const TRANSACTION: Group[] = ["transaction_async_cb", "transaction_await", "transaction_for_await"];

/** file -> the groups eslint MUST apply there, and the groups it must NOT.
 *  Every path is a real file; a rename that breaks one of these is a layout
 *  change that should be looked at, not routed around. */
const EXPECTATIONS: { file: string; must: Group[]; mustNot: Group[]; why: string }[] = [
  {
    file: "app/_lib/api-response.ts",
    must: [...DESIGN, ...TRANSACTION, "db_barrel", "no_route_import"],
    mustNot: ["portable_no_app"],
    why: "the lib layer — the block that wins here is the db-barrel block",
  },
  {
    file: "app/api/health/route.ts",
    must: [...DESIGN, ...TRANSACTION, "db_barrel", "no_route_import"],
    mustNot: ["portable_no_app"],
    why: "the api layer resolves through the same block as app/_lib",
  },
  {
    file: "app/features/shell/tabs.ts",
    must: [...DESIGN, ...TRANSACTION, "db_barrel", "no_route_import", "ui_no_db"],
    mustNot: ["portable_no_app"],
    why: "the ui block is a SUBSET of the db-barrel block and therefore replaces it",
  },
  {
    file: "app/_components/AiDisclosure.tsx",
    must: [...DESIGN, ...TRANSACTION, "db_barrel", "no_route_import", "ui_no_db"],
    mustNot: ["portable_no_app"],
    why: "shared primitives are the ui layer too, and are where hardcoded colors appear",
  },
  {
    file: "app/landing/page.tsx",
    // No `ui_no_db` here: app/landing/ is a route directory, not app/features
    // or app/_components, and UI_NO_DB_VALUE_IMPORT's own message names
    // `app/<route>/page.tsx` as the place a store value-import belongs. The
    // exemption drops the design law and nothing else the route layer carries.
    must: [...TRANSACTION, "db_barrel", "no_route_import"],
    mustNot: [...DESIGN, "ui_no_db"],
    why: "the one stated exemption from the design law — and it must keep every OTHER selector of its layer",
  },
  {
    file: "app/_lib/brand.ts",
    must: [...TRANSACTION, "db_barrel", "no_route_import"],
    mustNot: DESIGN,
    why: "the documented JS mirror of the @theme tokens; design:check pins these literals instead",
  },
  {
    file: "app/_components/puml/PlantUml.tsx",
    must: [...TRANSACTION, "db_barrel", "no_route_import", "ui_no_db"],
    mustNot: DESIGN,
    why: "diagram-only tints with no CSS-variable equivalent",
  },
  {
    file: "app/_dev-inspector/DevInspector.tsx",
    must: [...TRANSACTION, "db_barrel", "no_route_import"],
    mustNot: DESIGN,
    why: "a fixed devtools skin that must stay readable while you debug the theme",
  },
  {
    file: "app/_components/glyph/glyphs/analyticsGlyph.ts",
    must: [...TRANSACTION, "db_barrel", "no_route_import", "ui_no_db"],
    mustNot: DESIGN,
    why: "traced glyph source data, run through snapToToken() before it is painted",
  },
  {
    file: "packages/voice-stt/src/registry.ts",
    must: [...TRANSACTION, "db_barrel", "no_route_import", "portable_no_app"],
    mustNot: [...DESIGN, "ui_no_db"],
    why: "the portable lane: no design law, but the app-import wall is its whole point",
  },
  {
    file: "scripts/lint/ts-ratchet.mjs",
    must: TRANSACTION,
    mustNot: [...DESIGN, "db_barrel", "ui_no_db", "portable_no_app"],
    why: "scripts get the transaction law only — they are not app code and carry no design law",
  },
  {
    file: "scripts/interview-brief.ts",
    must: TRANSACTION,
    mustNot: [...DESIGN, "db_barrel", "ui_no_db", "portable_no_app"],
    why: "a TypeScript script is a script — same layer as the .mjs ones, which the globs used to miss",
  },
  {
    file: "proxy.ts",
    must: [...TRANSACTION, "db_barrel", "no_route_import"],
    mustNot: [...DESIGN, "ui_no_db", "portable_no_app"],
    why: "the middleware runs on EVERY request, so the db-barrel cost law binds it harder than anything under app/",
  },
  {
    file: "i18n/request.ts",
    must: [...TRANSACTION, "db_barrel", "no_route_import"],
    mustNot: [...DESIGN, "ui_no_db", "portable_no_app"],
    why: "locale resolution is imported by every server render — the server edge outside app/",
  },
  {
    file: "edge/src/index.ts",
    must: [...TRANSACTION, "db_barrel", "no_route_import", "portable_no_app"],
    mustNot: [...DESIGN, "ui_no_db"],
    why: "the other portable lane: deployed to the operator's own Cloudflare account, so the app-import wall is its whole design claim",
  },
  {
    file: "e2e/modal-escape.spec.ts",
    must: [...TRANSACTION, "no_route_import"],
    mustNot: [...DESIGN, "db_barrel", "ui_no_db", "portable_no_app"],
    why: "a spec drives the app over HTTP and asserts about rendered colour — the design law would be actively wrong here",
  },
];

async function messagesFor(file: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const config = (await eslint.calculateConfigForFile(path.join(REPO_ROOT, file))) as {
    rules?: Record<string, unknown>;
  };
  const entry = config.rules?.["no-restricted-syntax"];
  if (!Array.isArray(entry)) return [];
  return entry
    .slice(1)
    .map((o) => (typeof o === "object" && o !== null && "message" in o ? String((o as { message: unknown }).message) : ""))
    .filter(Boolean);
}

for (const { file, must, mustNot, why } of EXPECTATIONS) {
  test(`no-restricted-syntax coverage for ${file} (${why})`, async () => {
    const messages = await messagesFor(file);
    assert.ok(
      messages.length > 0,
      `eslint resolved NO no-restricted-syntax options for ${file}. Either the path moved or a ` +
        `later block dropped the rule entirely — both mean this file is currently ungated.`,
    );
    for (const g of must) {
      assert.ok(
        messages.some((m) => m.includes(GROUP[g])),
        `${file} is missing the "${g}" selector group.\n` +
          `Flat config REPLACES a rule's options — a later block matching this file was built without ` +
          `this group and switched it off. Add the group to that block's restrict(...) call in ` +
          `eslint.config.mjs (see the header note there). Resolved messages:\n  ` +
          messages.map((m) => m.slice(0, 70)).join("\n  "),
      );
    }
    for (const g of mustNot) {
      assert.ok(
        !messages.some((m) => m.includes(GROUP[g])),
        `${file} unexpectedly carries the "${g}" selector group — ${why}. ` +
          `An exemption stopped applying, which usually means a block was appended after the ` +
          `design-exempt block at the end of eslint.config.mjs.`,
      );
    }
  });
}

// Non-vacuity. Every assertion above is "this string appears in that list", and a
// typo in GROUP would make each one trivially satisfiable or trivially failing
// without anyone noticing which. Pin that the fixtures are real: the design group
// must be BOTH present somewhere and absent somewhere, so a change that switched
// the whole design law off (or on, everywhere) cannot pass this file.
test("the design group is genuinely present in one layer and genuinely absent in another", async () => {
  const gated = await messagesFor("app/features/shell/tabs.ts");
  const exempt = await messagesFor("app/landing/page.tsx");
  assert.ok(gated.some((m) => m.includes(GROUP.design_hex)), "app/features must be design-gated");
  assert.ok(!exempt.some((m) => m.includes(GROUP.design_hex)), "app/landing must be design-exempt");
  // …and both layers still share a group, so the two lists are not simply unrelated.
  assert.ok(
    gated.some((m) => m.includes(GROUP.transaction_await)) && exempt.some((m) => m.includes(GROUP.transaction_await)),
    "both layers must carry the transaction law — if not, the fixtures are not comparable",
  );
});

// ---------------------------------------------------------------------------
// REACH, not just layering. Every test above names a file by hand, so a whole
// DIRECTORY that no `files:` glob addresses is invisible to them: the config
// resolves no `no-restricted-syntax` options there at all, every assertion
// above still passes, and `npm run lint` is green over code no law applies to.
//
// That was the state of the tree. The floor block's globs were `app/**/*.ts`,
// `app/**/*.tsx`, `scripts/**/*.mjs`, `packages/**/*.ts` — which left the
// nineteen e2e specs, the root modules (proxy.ts, next.config.ts, the three
// instrumentation entry points), the whole of i18n/, the edge Worker and the
// two TypeScript scripts matching nothing. `edge/` is the sharpest case: it is
// the most portable lane in the repo, its header says "it holds no truth and no
// secrets", and the rule that keeps it liftable (no import of app/) did not
// reach it.
//
// So this derives the file list from git rather than from a hand-written array.
// A new top-level directory of TypeScript is covered the day it is added, or
// this fails naming it.
const TRACKED = execFileSync("git", ["ls-files", "-z", "*.ts", "*.tsx", "*.mts", "*.cts"], {
  cwd: REPO_ROOT,
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
})
  .split("\0")
  .filter(Boolean);

test("every tracked TypeScript file resolves to at least one no-restricted-syntax block", async () => {
  // Non-vacuity: a broken `git ls-files` must fail loudly rather than assert
  // over an empty set.
  assert.ok(TRACKED.length > 1000, `expected the tracked TS surface, found ${TRACKED.length} files`);

  const eslint = new ESLint({ cwd: REPO_ROOT });
  const unreached: string[] = [];
  for (const file of TRACKED) {
    // A path eslint is configured to ignore is not a gap — `.claude/**` is
    // agent worktrees, `.next*/**` is build output.
    if (await eslint.isPathIgnored(path.join(REPO_ROOT, file))) continue;
    const config = (await eslint.calculateConfigForFile(path.join(REPO_ROOT, file))) as {
      rules?: Record<string, unknown>;
    };
    if (!Array.isArray(config.rules?.["no-restricted-syntax"])) unreached.push(file);
  }

  assert.deepEqual(
    unreached,
    [],
    `${unreached.length} tracked TypeScript file(s) match NO no-restricted-syntax block, so none of ` +
      `this repo's syntax laws apply to them and lint is green over them by omission:\n  ` +
      unreached.slice(0, 40).join("\n  ") +
      (unreached.length > 40 ? `\n  …and ${unreached.length - 40} more` : "") +
      `\n\nAdd the layer to a block in eslint.config.mjs, built with restrict() from the selector ` +
      `sets it owes — not a new bare block, which would replace the options for everything it matches.`,
  );
});
