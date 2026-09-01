// KNOWN-BAD SNIPPETS — one per law in eslint.config.mjs, each at every layer that
// must reject it and every layer that must not.
//
// WHY THIS FILE EXISTS. Every other gate in this repository ships with fixtures:
// the ratchets, the doc checks, the chart policy, the dispatch guard, the review
// lenses. The eslint selectors did not, and they are the ones agent-written code
// meets first — the `db.transaction()` rules, the design law, the module-graph
// laws. Their correctness rested on the assumption that they still fire, and one
// of them had already stopped: the design law's config block was replaced whole by
// a later, wider block (flat config does not merge a rule's OPTIONS), so the ONE
// gate on hardcoded colors had been silently off across app/ with `npm run lint`
// green the entire time.
//
// The shape of the failure is what makes fixtures the only answer. A selector that
// no longer matches, a block whose options were replaced, an `ignores` that grew a
// glob too wide — every one of them reads as SUCCESS. There is nothing to see in
// the output, because the output is empty either way.
//
// SNIPPETS ARE DATA, NOT FILES. They are strings here rather than .ts files in a
// fixtures/ directory on purpose: a real file of deliberately-illegal code sitting
// in the tree is a file `eslint .` then has to be told to ignore, and an ignore
// added for a fixture is one more place the real rules can be switched off from.
// This module is a plain `.mjs` under scripts/, so the only law that reaches it is
// the transaction one, and every snippet below is inert to it — a string is not a
// call expression.
//
// `paths` are the file paths each snippet is linted AS. They need not exist: the
// point is which config blocks their path matches.

/** @typedef {{ law: string, code: string, expect: RegExp, rejects: string[], allows: string[] }} KnownBad */

const UI = "app/features/hiring/pipeline/Fixture.tsx";
const UI_COMPONENT = "app/_components/Fixture.tsx";
const ROUTE = "app/api/fixture/route.ts";
const LIB = "app/_lib/fixture.ts";
const STORE = "app/_lib/db/fixture.ts";
const PAGE = "app/fixture/page.tsx";
const PACKAGE = "packages/voice-tts/src/fixture.ts";
const SCRIPT = "scripts/fixture.mjs";
const APP_TEST = "app/_lib/fixture.test.ts";
const GLYPH = "app/_components/glyph/glyphs/fixtureGlyph.ts";
const PUML = "app/_components/puml/fixture.ts";
const LANDING = "app/landing/spark/Fixture.tsx";

/** @type {KnownBad[]} */
export const KNOWN_BAD = [
  {
    // The transaction law is the FLOOR: it has no exemption anywhere, including
    // tests and scripts. A test that awaits inside a transaction is testing
    // something that does not work.
    law: "async callback passed to db.transaction()",
    code: "export const run = db.transaction(async () => { await save(); });\n",
    expect: /async callback passed to db\.transaction\(\)/,
    rejects: [STORE, LIB, ROUTE, UI, UI_COMPONENT, PAGE, PACKAGE, SCRIPT, APP_TEST, GLYPH, PUML, LANDING],
    allows: [],
  },
  {
    law: "await inside db.transaction()",
    code: "export const run = db.transaction(async () => { await save(); });\n",
    expect: /await inside db\.transaction\(\)/,
    rejects: [STORE, UI, UI_COMPONENT, PACKAGE, SCRIPT, APP_TEST],
    allows: [],
  },
  {
    // `for await` is only legal inside an async function, so this snippet
    // necessarily trips the async-callback selector too. The assertion below is
    // on THIS message, which is the one that names the fix.
    law: "for-await inside db.transaction()",
    code: "export const run = db.transaction(async () => { for await (const r of rows) sink(r); });\n",
    expect: /for-await inside db\.transaction\(\)/,
    rejects: [STORE, UI, PACKAGE, SCRIPT],
    allows: [],
  },
  {
    // THE ONE THAT WAS OFF. Every path in `rejects` had stopped reporting it.
    law: "hardcoded color literal",
    code: 'export const style = { color: "#ff0000" };\n',
    expect: /Hardcoded color\./,
    rejects: [UI, UI_COMPONENT, ROUTE, LIB, PAGE, STORE],
    // The stated exemptions in the design law, plus tests (whose hexes are inputs
    // to the color sanitizers) and packages/ (which render nothing).
    allows: [LANDING, GLYPH, PUML, APP_TEST, PACKAGE],
  },
  {
    law: "hardcoded color in a template literal",
    code: "export const cls = `bg-[#ff0000] text-white`;\n",
    expect: /Hardcoded color in a template literal/,
    rejects: [UI, UI_COMPONENT, ROUTE, PAGE],
    allows: [LANDING, GLYPH, APP_TEST],
  },
  {
    law: "inline rgba()",
    code: 'export const style = { boxShadow: "0 1px 2px rgba(0, 0, 0, 0.2)" };\n',
    expect: /Inline rgb\(\)\/rgba\(\) color/,
    rejects: [UI, UI_COMPONENT, ROUTE, PAGE],
    allows: [LANDING, PUML, APP_TEST],
  },
  {
    law: "value import of the @/app/_lib/db barrel",
    code: 'import { getJob } from "@/app/_lib/db";\nexport const j = getJob;\n',
    expect: /value import of the @\/app\/_lib\/db barrel/,
    rejects: [ROUTE, LIB, UI, UI_COMPONENT, PAGE, PACKAGE, GLYPH, PUML],
    // `import type` is erased before bundling and costs nothing — the exemption
    // the cost law is built around — and a test is never compiled into a route.
    allows: [APP_TEST],
  },
  {
    law: "import type of the barrel stays legal",
    code: 'import type { Job } from "@/app/_lib/db";\nexport type J = Job;\n',
    expect: /value import of the @\/app\/_lib\/db barrel/,
    rejects: [],
    allows: [ROUTE, LIB, UI, UI_COMPONENT, PACKAGE],
  },
  {
    law: "import of an API route handler",
    code: 'import { GET } from "@/app/api/health/route";\nexport const g = GET;\n',
    expect: /import of an API route handler/,
    rejects: [ROUTE, LIB, UI, UI_COMPONENT, PAGE, PACKAGE],
    allows: [APP_TEST],
  },
  {
    law: "value import of a db store from a UI module",
    code: 'import { listJobs } from "@/app/_lib/db/jobs";\nexport const l = listJobs;\n',
    expect: /value import of a db store from a UI module/,
    // The colour-exempt paths inside the UI layer still owe this one — that split
    // is exactly what the two UI config blocks exist for.
    rejects: [UI, UI_COMPONENT, GLYPH, PUML],
    // A server component and a route handler legitimately read the DB.
    allows: [ROUTE, PAGE, LIB, APP_TEST],
  },
  {
    law: "a package importing from app/",
    code: 'import { brand } from "@/app/_lib/brand";\nexport const b = brand;\n',
    expect: /a package importing from app\//,
    rejects: [PACKAGE],
    allows: [UI, ROUTE, LIB],
  },
];

/**
 * The selector each layer must have CONFIGURED, checked separately from whether a
 * snippet is reported. Same failure, read the other way round: `rejects` above
 * proves the rule fires, this proves the options survived the last config block
 * that matched the path — which is the thing that silently changed.
 */
export const EXPECTED_SELECTORS = [
  { path: SCRIPT, laws: ["transaction"], not: ["color", "barrel", "ui-db", "packages-app"] },
  { path: APP_TEST, laws: ["transaction"], not: ["color", "barrel", "ui-db"] },
  { path: ROUTE, laws: ["transaction", "color", "barrel", "route-handler"], not: ["ui-db", "packages-app"] },
  { path: LIB, laws: ["transaction", "color", "barrel", "route-handler"], not: ["ui-db"] },
  { path: UI, laws: ["transaction", "color", "barrel", "route-handler", "ui-db"], not: ["packages-app"] },
  { path: UI_COMPONENT, laws: ["transaction", "color", "barrel", "route-handler", "ui-db"], not: [] },
  { path: GLYPH, laws: ["transaction", "barrel", "route-handler", "ui-db"], not: ["color"] },
  { path: PUML, laws: ["transaction", "barrel", "route-handler", "ui-db"], not: ["color"] },
  { path: LANDING, laws: ["transaction", "barrel", "route-handler"], not: ["color", "ui-db"] },
  { path: PACKAGE, laws: ["transaction", "barrel", "route-handler", "packages-app"], not: ["color", "ui-db"] },
];

/** How a law is recognised in a resolved `no-restricted-syntax` option list. */
export const LAW_SIGNATURE = {
  transaction: /callee\.property\.name='transaction'/,
  color: /0-9a-fA-F\]\{6\}/,
  barrel: /source\.value='@\/app\/_lib\/db'/,
  "route-handler": /route\(\\\.tsx\?\)\?\$/,
  "ui-db": /_lib\\x2fdb\\x2f/,
  "packages-app": /\(\\\.\\\.\\x2f\)\+/,
};
