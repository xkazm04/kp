import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import i18next from "eslint-plugin-i18next";

// ===========================================================================
// ONE RULE, SIX AUDIENCES — and why this file is composed rather than written.
//
// Every law below is a selector for `no-restricted-syntax`, and flat config DOES
// NOT MERGE A RULE'S OPTIONS: when several config objects match a file, the LAST
// one's options REPLACE the earlier ones entirely. A block that lists only its
// own selector therefore switches every other selector OFF for every file it
// matches — silently, with `npm run lint` still green, because a rule that never
// runs reports nothing.
//
// This file used to answer that by asking each block to re-type the selectors it
// inherited, in a comment ("Spread them into both", "adding a selector there
// without adding it here switches it off for the whole UI layer"). That is a
// convention, and it had already failed: the design-law block — the ONE gate on
// hardcoded colors, which ci.yml's design:check step names as "an eslint rule, so
// it rides `npm run lint`" — sat above a `files: ["app/**/*.ts", "app/**/*.tsx"]`
// block that replaced its options for every file it covered. The colour law had
// stopped running across the whole of app/ and nothing said so.
//
// So the selectors are now DECLARED as sets, and every block is BUILT by
// `restrict()` from the sets that apply to it. A new law is added to its set
// once; there is nothing left to forget to restate. The layering rule is the
// only thing left to get right, and it is stated at the config array below.
//
// app/lint-selector-coverage.test.ts is the other half: it asks the real ESLint
// what it RESOLVES for a file at each layer, so a law that stops firing fails a
// test instead of going quiet. It also derives the whole tracked TypeScript
// surface from `git ls-files` and requires every file in it to match at least
// one block — the gap that let e2e/, i18n/, edge/ and the root modules sit
// outside every law with lint green.
//
// (This note used to point at `scripts/lint/__tests__/eslint-gates.test.mjs`,
// which has never existed in this tree. A pointer to a guard that is not there
// reads exactly like a guard that is — which is the failure mode the guard was
// written to prevent, one level up.)
// ===========================================================================

/** Every block's `no-restricted-syntax` is built here, never hand-listed. */
const restrict = (...selectors) => ({ "no-restricted-syntax": ["error", ...selectors] });

// The three `db.transaction()` selectors — the floor, applied to every file this
// config reaches.
const TRANSACTION_SELECTORS = [
  {
    selector:
      "CallExpression[callee.property.name='transaction'] > :matches(ArrowFunctionExpression, FunctionExpression)[async=true]",
    message:
      "async callback passed to db.transaction(). better-sqlite3 transactions are synchronous — " +
      "an async callback breaks atomicity silently. Do the awaited work BEFORE or AFTER the " +
      "transaction and bridge the gap with a CAS on the row you read (see actOnPipelineEntry " +
      "in app/_lib/db/pipeline.ts)."
  },
  {
    selector: "CallExpression[callee.property.name='transaction'] AwaitExpression",
    message:
      "await inside db.transaction(). better-sqlite3 transactions are synchronous — the await " +
      "yields mid-transaction and the atomicity is silently lost. Move the awaited work outside " +
      "and re-check the row's state on the way back in (see actOnPipelineEntry in " +
      "app/_lib/db/pipeline.ts)."
  },
  {
    selector: "CallExpression[callee.property.name='transaction'] ForOfStatement[await=true]",
    message:
      "for-await inside db.transaction(). better-sqlite3 transactions are synchronous — iterate " +
      "the async source outside the transaction, then commit the collected rows inside it."
  }
];

// ---------------------------------------------------------------------------
// LAYER BOUNDARIES — which context may import which.
//
// context-map.json splits this tree into 143 contexts across 17 groups, and
// every context carries a `category` (ui · api · lib · data · test). That
// category IS the layer axis, and until now nothing read it: an agent scoped to
// one context could wire any module to any other and only review would notice.
// A context map is a description; these selectors are the part that holds.
//
// WHAT IS DELIBERATELY *NOT* HERE. The map's per-context `file_paths` are a
// generated snapshot (2026-08-21) that drifts as files move, so a rule keyed to
// them would go red on a rename rather than on a coupling mistake. These rules
// are keyed to the DIRECTORY layout the categories describe, which is the part
// that is stable and that `files:` globs can actually address.
//
// Every selector below starts at ZERO violations in this tree — verified across
// app/ and packages/ before it was written, counting `import type` separately
// from value imports. That is the same standard TRANSACTION_SELECTORS and the
// db-barrel rule were held to (see their notes): a rule that starts clean means
// anything it ever fires on is new, which is what `error` is for. None of these
// needed a ratchet, so none has one — the debt to declare was empty.
//
// `\x2f` IN THE SELECTORS BELOW IS A SLASH, written the long way on purpose.
// esquery parses an attribute regex as `"/" [^/]+ "/"`, so a literal `/` in the
// pattern — escaped or not — terminates the regex early and leaves a selector
// that silently matches nothing: a rule that is green because it is broken, which
// is the worst failure mode a gate has. Every selector already in this file
// matches a value or a bare specifier and so never needed a path, which is why
// none of them hit this. `\x2f` is the same character to `new RegExp` and is
// invisible to esquery's terminator. Do not "simplify" these back to `\/`.
// ---------------------------------------------------------------------------

// A route handler is an HTTP entry point, not a module. Importing one runs its
// module side effects in the importer's graph and couples a caller to a
// transport shape that only Next is supposed to invoke — and it silently drags
// the handler's whole server-side graph (db, python-runner, llm) into whatever
// imported it. The seam between layers is `fetch("/api/…")` or the lib function
// the handler itself calls; never the handler.
const NO_ROUTE_HANDLER_IMPORT = {
  selector: "ImportDeclaration[source.value=/api\\x2f.+\\x2froute(\\.tsx?)?$/]",
  message:
    "import of an API route handler. A route is an HTTP entry point, not a module: importing it runs " +
    "its side effects in your graph and couples you to a transport shape. Call it over HTTP, or — better — " +
    "import the lib function the handler itself calls (app/_lib/…), which is the seam that was meant to be shared."
};

// The `ui` contexts (app/features/**, app/_components/**) are the tab modules
// and shared primitives. They reach data through a route handler; the DB is the
// `data` layer's business. A VALUE import of a store from here compiles
// better-sqlite3 into a component graph — and `import type` is exempt because it
// is erased before bundling and costs nothing, exactly the line the db-barrel
// rule below already draws. Every one of the ~40 db imports under app/features/
// today is already an `import type`; the value imports all live in
// app/<route>/page.tsx server components, which are outside this glob and
// legitimately read the DB.
const UI_NO_DB_VALUE_IMPORT = {
  selector: "ImportDeclaration[importKind!='type'][source.value=/_lib\\x2fdb\\x2f/]",
  message:
    "value import of a db store from a UI module. app/features/** and app/_components/** reach data through " +
    "a route handler — a store imported here pulls better-sqlite3 into a component graph. Use `import type` " +
    "(erased, free) for the row shape, fetch the data from an /api route, or put the read in a server " +
    "component under app/<route>/page.tsx, which is where the value imports belong."
};

// packages/ is the portable lane: packages/voice-tts is built to be lifted out
// of this repo intact (its providers sit behind /api/tts and are swapped by env).
// An import of app/ — of ANY kind, including `import type`, because the breakage
// is to source portability rather than to bundle size — is the edge that quietly
// makes it unliftable. Dependencies point packages -> nothing, app -> packages.
const PACKAGES_NO_APP_IMPORT = {
  selector: "ImportDeclaration[source.value=/^(@\\x2f|(\\.\\.\\x2f)+)app\\x2f/]",
  message:
    "a portable-lane module importing from app/. packages/** and edge/** are meant to be liftable out of " +
    "this repo — edge/ is deployed to the operator's OWN Cloudflare account and is excluded from the root " +
    "tsconfig — so the dependency only ever points app/ -> packages/. Move the shared value INTO the lane " +
    "(and import it from app/), or take it as a parameter/config the app passes in."
};

// The cost law, extracted so the blocks below can restate it. `app/_lib/db.ts`
// is an `export *` barrel over 17 store modules — see the long note on the
// config block that first carried this rule.
const DB_BARREL_SELECTOR = {
  selector: "ImportDeclaration[importKind!='type'][source.value='@/app/_lib/db']",
  message:
    "value import of the @/app/_lib/db barrel. It re-exports 17 store modules, and next compiles " +
    "a route's whole module graph — one barrel import here taxes every route downstream (it cost " +
    "/api/health 41 modules and 538 KB before the sweep). Import the slice you need " +
    "(@/app/_lib/db/pipeline, @/app/_lib/db/jobs, …), or make it an `import type`, which is free."
};

// ---------------------------------------------------------------------------
// Design law: no hardcoded colors outside app/landing/.
//
// ".claude/CLAUDE.md" has always said "Never hardcode colors (bg-[#...], inline
// style colors, rgba shadows) outside app/landing/ — everything else resolves
// through tokens", and for a while nothing enforced it. A literal hex cannot
// follow [data-theme="dark"], so every one of them is a surface that silently
// stops theming.
//
// AST-based on purpose: it sees string literals and template chunks (so
// `bg-[#fff]`, style={{ color: "#fff" }} and a `rgba(...)` box-shadow all trip)
// but NOT comments, which legitimately quote hexes when explaining a token.
// Six-digit only — three-digit `#abc` collides with issue refs and URL
// fragments, and the codebase's 3-digit hexes are all test data.
//
// The end-of-hex anchor is `(?![0-9a-fA-F])`, NOT `\b`, and that is the whole
// point of it. `\b` asks for a word/non-word transition, so a hex followed by
// ANY word character was silently exempt — and Tailwind spells the space inside
// an arbitrary value as `_`, a word character. That is exactly how
// `[background-image:repeating-linear-gradient(45deg,#d6d3d1_0px,…)]` sat on the
// Fit Matrix's blocked cell for months while `npm run lint` and
// `npm run design:check` both reported clean (design:check delegates the hex
// gate to this rule). The negative lookahead only exempts a LONGER hex run (an
// 8-digit #rrggbbaa, which `\b` also let through), so every non-hex follower —
// `_`, `)`, `;`, a quote, end of string — is now caught.
//
// The companion checks live in scripts/design/check-design-tokens.mjs (brand.ts
// <-> globals.css lockstep, and dark-mapping parity for every shade utility),
// wired as `npm run design:check`.
// ---------------------------------------------------------------------------
const COLOR_SELECTORS = [
  {
    selector: "Literal[value=/#[0-9a-fA-F]{6}(?![0-9a-fA-F])/]",
    message:
      "Hardcoded color. Colors must resolve through tokens so they follow [data-theme=\"dark\"] — " +
      "use a Tailwind token utility, var(--color-*), or app/_lib/brand.ts for stylesheet-less " +
      "surfaces. If the color has no token, add one to app/globals.css (both themes). See docs/design/README.md."
  },
  {
    selector: "TemplateElement[value.raw=/#[0-9a-fA-F]{6}(?![0-9a-fA-F])/]",
    message:
      "Hardcoded color in a template literal. Colors must resolve through tokens so they follow " +
      "[data-theme=\"dark\"]. See docs/design/README.md."
  },
  {
    selector: "Literal[value=/rgba?\\(\\s*[0-9]/]",
    message:
      "Inline rgb()/rgba() color. Shadows and scrims must resolve through tokens so they follow " +
      "[data-theme=\"dark\"] — add a --color-* or --shadow-* token to app/globals.css instead. " +
      "See docs/design/README.md."
  },
  {
    selector: "TemplateElement[value.raw=/rgba?\\(\\s*[0-9]/]",
    message:
      "Inline rgb()/rgba() color in a template literal. Resolve it through a token so it follows " +
      "[data-theme=\"dark\"]. See docs/design/README.md."
  }
];

/** Where a literal color is the point of the file rather than a mistake. */
const COLOR_EXEMPT = [
  // Fixed art direction, the one stated exemption in the design law.
  "app/landing/**",
  // The documented JS mirror of the @theme tokens, for surfaces the CSS token
  // system cannot reach (OG card, apple-icon, raw SVG fills). These literals are
  // the point of the file — and design:check now pins every one of them to its
  // --color-* declaration, so they cannot drift.
  "app/_lib/brand.ts",
  // Traced glyph SOURCE data, never painted: MotionizedGlyph runs every fill
  // through snapToToken() (app/_components/glyph/glyphTokens.ts) and emits
  // var(--color-*). ~250 literals that are already tokens by the time they reach
  // the DOM — the best-engineered thing in this cluster.
  "app/_components/glyph/glyphs/**",
  // Diagram-only primitive tints (database cylinder, cloud, sticky note, group
  // boxes) with no CSS-variable equivalent. The brand-mirroring half of the
  // palette now imports from brand.ts; the bespoke half stays literal until the
  // diagram gets a dark register of its own.
  "app/_components/puml/**",
  // Dev-only inspector chrome (DEV_INSPECT=1). Deliberately a FIXED devtools
  // skin that must not follow the app theme — it has to stay readable while you
  // are debugging the theme itself.
  "app/_dev-inspector/**",
  // Test data: hexes here are inputs and expected values for the color
  // sanitizers and the glyph token snapper, not rendered color.
  "app/**/*.test.{ts,tsx}"
];

/**
 * A test is never compiled into a route, so its module graph is not a request
 * cost, and it is allowed to drive a store directly to set up its fixture. The
 * transaction law has no such exemption: a test that awaits inside a transaction
 * is testing something that does not work.
 */
const TEST_FILES = ["app/**/*.test.ts", "app/**/*.test.tsx", "packages/**/*.test.ts"];

const APP_AND_PACKAGES = ["app/**/*.ts", "app/**/*.tsx", "packages/**/*.ts"];
const UI_LAYER = [
  "app/features/**/*.ts",
  "app/features/**/*.tsx",
  "app/_components/**/*.ts",
  "app/_components/**/*.tsx"
];

// The module-graph laws every non-test file under app/ and packages/ carries.
const GRAPH_SELECTORS = [DB_BARREL_SELECTOR, NO_ROUTE_HANDLER_IMPORT];

const config = [
  ...nextVitals,
  ...nextTypescript,
  {
    // `.claude/**` holds harness internals — notably `worktrees/`, full repo
    // copies from isolated agent runs. Without this, `eslint .` traverses those
    // stale checkouts and reports their (pre-existing, unrelated) violations as
    // if they were this tree's. eslint has no business in .claude.
    ignores: [".next/**", ".next-empty/**", "node_modules/**", "test-results/**", ".claude/**"]
  },
  {
    // ---------------------------------------------------------------------
    // Error-door law: a catch body is never empty. An intentional drop carries
    // its reason IN the block — `/* best-effort: the ledger is telemetry */`,
    // `/* column already exists — idempotent */` — which is what 164 catch sites
    // in this tree already do (architect census, 2026-09-01) and what
    // app/_lib/db/core.ts's migrator comments argue for: a bare `catch {}`
    // booted a structurally-broken DB and started the "why is everything
    // empty" hunt. `no-empty` treats a block containing only a comment as
    // non-empty, so the comment IS the declaration, and `allowEmptyCatch:
    // false` is the whole point. Shipped at `error` with 0 violations (the
    // three `catch{}` grep hits in core.ts are inside comments; the one in
    // app/layout.tsx is inside a <script> string) — so, like the transaction
    // selectors above, there was no debt to ratchet.
    //
    // What this does NOT gate, said plainly: a catch that logs to nowhere or
    // returns a default without a door is non-empty and passes. That is the
    // door-coverage census's business (scripts, not lint) — this rule pins the
    // declaration convention, not routing.
    // ---------------------------------------------------------------------
    // `uat/` is recorded driver scripts and archived shots, not product code: the
    // 0-violation baseline was measured over the product tree, and 16 empty
    // blocks live only there (pre-push runs `eslint .`, so this carve-out is
    // what keeps the gate honest rather than the cache).
    ignores: ["uat/**"],
    rules: {
      "no-empty": ["error", { allowEmptyCatch: false }]
    }
  },
  {
    // i18n gap prevention: flag hardcoded user-facing JSX text so new strings go
    // through messages/*.json (next-intl t()) instead of being baked in. Scoped
    // to component files (.tsx under app/, excluding tests) and held at WARN
    // during the phased migration — it surfaces the remaining hardcoded surface
    // without blocking unrelated work. Flip to "error" per area as each is
    // migrated (Phase 4). `jsx-text-only` mode keeps it low-noise: only visible
    // text nodes, not className/data-*/href attributes.
    files: ["app/**/*.tsx"],
    ignores: ["app/**/*.test.tsx"],
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": ["warn", { mode: "jsx-text-only" }]
    }
  },
  {
    // Migrated, fully-localized surfaces graduate from warn to ERROR so a new
    // hardcoded string can't regress them. The plugin is declared once above
    // (this block only raises the level). Grown per area as each phase completes.
    //   Phase 3 — candidate-facing: offer, schedule, apply, shared AiDisclosure.
    // Note: `**` globs, not the literal `app/offer/[token]/...`, because `[token]`
    // is a glob character class.
    files: [
      // The public marketing pages. `app/landing/**` used to switch this rule
      // OFF entirely — a carve-out from when /landing held throwaway rebrand
      // prototypes. That variant was promoted: these components now serve `/`,
      // `/about` and `/market` in production, in four languages, so the
      // carve-out was retiring 50 hardcoded strings' worth of debt by ignoring
      // it. They are migrated (landing.previews.*, aboutPage.art.*) and held at
      // ERROR. Brand spelling and illustrative figures are named constants, not
      // JSX text, so they are structurally invisible to the rule rather than
      // needing per-site disables — see spark/Wordmark.tsx.
      "app/landing/**/*.tsx",
      "app/about/**/*.tsx",
      "app/market/**/*.tsx",
      // Migrated by the F12b pass: the panel is fully catalog-driven and the
      // server now hands it machine codes and structured findings rather than
      // English prose (see docs/architecture/localization.md).
      "app/_components/GithubAnalysisPanel.tsx",
      "app/_components/AiDisclosure.tsx",
      "app/offer/**/*.tsx",
      "app/schedule/**/*.tsx",
      "app/apply/**/*.tsx",
      "app/interview/**/*.tsx",
      "app/_components/voice/**/*.tsx",
      // The workspace, by menu group (docs/architecture/app-structure.md). Same
      // seventeen surfaces the old `sub_*` globs covered, re-pointed at the menu
      // tree — NOT the whole tree: `tools/devcases` and `hiring/onboarding` were
      // deliberately outside this rule (dev-facing copy) and stay outside it.
      "app/features/shell/Workspace.tsx",
      "app/features/shell/WorkspaceNav.tsx",
      "app/features/shell/setup/**/*.tsx",
      // The guided demo (F2). `/api/demo` → `/?sim=auto` is where the localized
      // landing page's "Try the live demo" CTA lands, so this was the most-seen
      // English-only surface in a four-language product. The whole walk — step
      // titles, spotlight captions, the run log, the explainer drawer + its
      // PlantUML diagrams, the screening-wave modal and the demo JD body — now
      // reads from the `simulation` namespace, so it graduates to ERROR.
      "app/features/shell/simulation/**/*.tsx",
      // The Background-tasks tab (F9). The whole surface reads from the `tasks`
      // namespace — including the three operator panels, which were English "by
      // design" only by analogy with each other. What is left literal in there is
      // structurally not copy and is held in named constants or commented at the
      // site: engine proper nouns, the env-var/PATH preflight tooltips, schema and
      // stage identifiers, `kp.ats.v1` / `X-Kp-Signature`, the example webhook URL.
      // Task LABELS are the interesting case: they are written server-side with no
      // reader locale, so the row stores a catalog reference (app/_lib/task-label.ts)
      // that resolves at render time — a lint on JSX text could never have caught
      // those, which is why this glob is evidence of a migration, not the migration.
      "app/features/shell/tasks/**/*.tsx",
      "app/features/hiring/pipeline/**/*.tsx",
      "app/features/hiring/decisions/**/*.tsx",
      "app/features/hiring/schedule/**/*.tsx",
      "app/features/hiring/channels/**/*.tsx",
      "app/features/library/**/*.tsx",
      "app/features/tools/match/**/*.tsx",
      "app/features/tools/profile/**/*.tsx",
      "app/features/tools/analyze/**/*.tsx",
      "app/features/tools/interview/**/*.tsx",
      "app/features/insights/**/*.tsx",
      "app/features/shared/**/*.tsx",
      // F10 — Settings → Organization. The member roster, invite row, permission
      // editor and both destructive confirms now read from `workspaceAdmin.{org,
      // members,permissions}`. The load-bearing part was NOT the JSX: the five role
      // names, three member statuses and four capability label/description pairs
      // lived in `app/features/shared/memberUi.ts`, a plain module no lint mode can
      // read — and they leaked into `shell/setup/SetupInviteEditor.tsx` and
      // `app/invite/[token]/AcceptForm.tsx`, two surfaces that were already at
      // ERROR and therefore looked localized while rendering English. Those helpers
      // now take a bound translator from the caller.
      "app/features/settings/organization/**/*.tsx",
      // F8 — the autonomy control room. Split from one 462-line component into a
      // shell + four panels, and the whole surface now reads from the `control`
      // namespace. As with the tasks tab, the JSX text was the easy half: the six
      // aria-label/placeholder attributes and the five calibration rationale
      // sentences in `app/_lib/dev-outcomes.ts` are structurally invisible to this
      // rule, and the rationale is now a `{ kind, params }` finding the panel
      // renders. What stays literal is audit payload — the lifecycle `stage`/
      // `detail` and the audit row's `actor`/`action`/`reason` are fields of a
      // sealed record and must read identically in every locale (same split as
      // `approvedBy`/`reasonCode` in the decision chain).
      "app/control/**/*.tsx",
      // channels-i18n-honesty (main): the Channels tab + Comms Center graduated off
      // their six prototype-stage `no-literal-string` disables — they are held at
      // ERROR so a new hardcoded string cannot quietly re-English the surface. Their
      // files now live under hiring/channels/**, already covered by the glob above.
    ],
    rules: {
      "i18next/no-literal-string": ["error", { mode: "jsx-text-only" }]
    }
  },
  {
    // better-sqlite3 transactions are SYNCHRONOUS. A `db.transaction(cb)` runs cb
    // between BEGIN and COMMIT on one connection — so an `await` inside cb yields the
    // event loop mid-transaction, lets other work interleave on the same connection,
    // and silently breaks the atomicity the transaction was written to provide. There
    // is no error and no failing test: the code looks transactional and is not.
    //
    // The repo currently has ZERO violations across its 34 transaction call sites, and
    // defends the invariant in prose at the tempting ones (see the comment beside
    // scrubEntryLinkedPii in app/_lib/db/pipeline.ts: "stays SYNCHRONOUS: a stray await
    // would silently break the transaction's atomicity"). An /architect scan flagged
    // that as the cheapest strong-pattern-to-gate conversion available: the invariant
    // is fully mechanical, and a comment is not a gate (ADR 0007).
    //
    // ERROR, not warn, and deliberately: warn is this config's phased-migration level
    // (see the i18n blocks). There is nothing to migrate here — the rule starts clean,
    // so anything it ever fires on is a new defect, which is what error is for.
    //
    // The long-running-work pattern this rule pushes you toward already exists:
    // actOnPipelineEntry does the await OUTSIDE the transaction and bridges the gap
    // with a compare-and-swap on the row it read (expectedStage / expectedApprovalKind),
    // so a decision computed during a 30-second LLM call is safely dropped if the row
    // moved. Copy that, don't await inside the lock.
    //
    // THE FLOOR OF THE STACK. The five blocks below are progressively narrower
    // and each REPLACES this one for the files it matches, so each rebuilds this
    // set through `restrict()` rather than inheriting it. Read them top to
    // bottom: every file lands in exactly one, and it is the last one that
    // matches it.
    //
    // THE FLOOR IS THE WHOLE TRACKED SURFACE, and it was not: these globs used
    // to read `app/**/*.ts`, `app/**/*.tsx`, `scripts/**/*.mjs`,
    // `packages/**/*.ts`, which left 38 tracked TypeScript files — every e2e
    // spec, all of i18n/, the edge Worker, the root modules (proxy.ts,
    // next.config.ts, the instrumentation entry points), the `.d.mts` ambient
    // files and the two TypeScript scripts — matching NO block at all. eslint
    // resolved no options for them, so the transaction law never applied there
    // and `npm run lint` was green over them by omission rather than by
    // compliance. `.mts` is listed explicitly because `**/*.ts` does not match
    // it. app/lint-selector-coverage.test.ts now derives the list from
    // `git ls-files` and fails naming any file that falls outside every block.
    files: [
      "app/**/*.ts",
      "app/**/*.tsx",
      "app/**/*.mts",
      "scripts/**/*.mjs",
      "scripts/**/*.ts",
      "scripts/**/*.mts",
      "packages/**/*.ts",
      "packages/**/*.mts",
      "e2e/**/*.ts",
      "i18n/**/*.ts",
      "edge/**/*.ts",
      "*.ts",
      "*.mts"
    ],
    rules: restrict(...TRANSACTION_SELECTORS)
  },
  {
    // ---------------------------------------------------------------------
    // Cost law: import the SLICE, not the `app/_lib/db` barrel.
    //
    // `app/_lib/db.ts` is an `export *` barrel over 17 store modules — 52
    // first-party modules, ~707 KB of source — and next compiles a route's
    // ENTIRE module graph, so one value import of it drags the whole data layer
    // into the importer AND into every route downstream. Measured, not guessed
    // (docs/architecture/app-structure.md, "API route graphs"): cutting the
    // barrel out of two hub modules took `/api/health` from 55 modules · 718 KB
    // to 14 · 180 KB and `/api/attention` from 68 · 863 KB to 43 · 560 KB, and a
    // 178-file sweep left exactly one non-type importer in the tree.
    //
    // That result is currently protected by prose alone. Nothing re-reads a
    // route graph, so the next `import { … } from "@/app/_lib/db"` in a hub
    // re-inflates a hundred routes with every gate still green — typecheck
    // passes, tests pass, the app is just slower. This is the cheapest place to
    // make it fail instead: `npm run lint` runs in ci.yml (node-quality) and in
    // .githooks/pre-push.
    //
    // `no-restricted-syntax` rather than `no-restricted-imports`, because the
    // selector can read `importKind`: `import type` is erased before bundling,
    // costs nothing, and must stay legal — exactly the line app-structure.md
    // draws. Tests are exempt: a test file is never compiled into a route, so
    // its graph is not a request cost.
    //
    // ERROR, and the rule starts clean at zero violations, so anything it ever
    // fires on is new. The fix is always the same shape: import the slice
    // (`@/app/_lib/db/pipeline`), or make it an `import type`.
    //
    // The wider budget this belongs to — per-route module ceilings, recorded
    // and ratcheted — is scripts/perf/check-budget.mjs; see
    // docs/development/performance-budget.md.
    // ---------------------------------------------------------------------
    // Nobody imports a route handler either — true of every layer, so it rides
    // this block rather than needing one of its own.
    files: APP_AND_PACKAGES,
    ignores: TEST_FILES,
    rules: restrict(...TRANSACTION_SELECTORS, ...GRAPH_SELECTORS)
  },
  {
    // The design law, over everything under app/ that is not one of the stated
    // exemptions. Narrower than the block above (it is app/ only and drops the
    // exempt paths), so it comes after it and carries everything it carried.
    files: ["app/**/*.ts", "app/**/*.tsx"],
    ignores: COLOR_EXEMPT,
    rules: restrict(...TRANSACTION_SELECTORS, ...GRAPH_SELECTORS, ...COLOR_SELECTORS)
  },
  {
    // ---------------------------------------------------------------------
    // The `ui` layer: app/features/** (the tab modules) and app/_components/**
    // (shared primitives), MINUS the colour-exempt paths inside it — the traced
    // glyph data and the diagram primitives both live under app/_components/.
    // Those files still owe every other law, which is what this block is for;
    // the one below adds the colour law back for the rest of the layer.
    // ---------------------------------------------------------------------
    files: UI_LAYER,
    ignores: TEST_FILES,
    rules: restrict(...TRANSACTION_SELECTORS, ...GRAPH_SELECTORS, UI_NO_DB_VALUE_IMPORT)
  },
  {
    // The rest of the UI layer: every law, including colour. This is the block
    // most component files land in, and it is last for that reason.
    files: UI_LAYER,
    ignores: COLOR_EXEMPT,
    rules: restrict(...TRANSACTION_SELECTORS, ...GRAPH_SELECTORS, UI_NO_DB_VALUE_IMPORT, ...COLOR_SELECTORS)
  },
  {
    // The portable lane. `packages/**` is outside app/, so no colour law here —
    // these modules render nothing.
    files: ["packages/**/*.ts"],
    ignores: ["packages/**/*.test.ts"],
    rules: restrict(...TRANSACTION_SELECTORS, ...GRAPH_SELECTORS, PACKAGES_NO_APP_IMPORT)
  },
  {
    // ---------------------------------------------------------------------
    // The SERVER EDGE of the app that is not under app/: the root modules
    // (proxy.ts — the middleware that fails closed on a keyless production
    // boot; next.config.ts; the three instrumentation entry points) and i18n/,
    // which resolves the request locale and is imported by every server render.
    //
    // They owe the module-graph laws for the same reason app/_lib does, and more
    // sharply: proxy.ts runs on EVERY request, so a db-barrel value import there
    // is the most expensive one in the repo. No colour law — none of these
    // render, and none is a .tsx file.
    // ---------------------------------------------------------------------
    files: ["i18n/**/*.ts", "*.ts", "*.mts"],
    rules: restrict(...TRANSACTION_SELECTORS, ...GRAPH_SELECTORS)
  },
  {
    // ---------------------------------------------------------------------
    // The OTHER portable lane. edge/ is a Cloudflare Worker deployed to the
    // operator's own account, with its own package.json and tsconfig (the root
    // tsconfig excludes it), and its whole design claim is that it "holds no
    // truth and no secrets". An import of app/ — of any kind, `import type`
    // included, because the breakage is to portability rather than to bundle
    // size — is what would quietly make it unliftable, and until now the rule
    // that says so reached packages/ only.
    //
    // Its own tests are in edge/test/ and land here too: the app-import wall is
    // a source-portability rule, so it binds a test exactly as it binds the
    // Worker. The mirror of this protocol lives in app/_lib/edge-*.ts, which is
    // app/ importing the shared shape — the direction that is allowed.
    // ---------------------------------------------------------------------
    files: ["edge/**/*.ts"],
    rules: restrict(...TRANSACTION_SELECTORS, ...GRAPH_SELECTORS, PACKAGES_NO_APP_IMPORT)
  },
  {
    // ---------------------------------------------------------------------
    // The e2e suite. A spec is never compiled into a route, so it carries the
    // graph laws no more than app/**/*.test.ts does, and it asserts about
    // rendered colour often enough that the design law would be actively wrong
    // here. What it DOES owe is the transaction law (the fixtures in
    // e2e/fixtures/ talk to the same better-sqlite3 stores) and the
    // route-handler wall: a spec drives the app over HTTP — importing a handler
    // and calling it in-process is a test of something the browser never does.
    // ---------------------------------------------------------------------
    files: ["e2e/**/*.ts"],
    rules: restrict(...TRANSACTION_SELECTORS, NO_ROUTE_HANDLER_IMPORT)
  }
];

export default config;
