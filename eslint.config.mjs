import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import i18next from "eslint-plugin-i18next";

// The three `db.transaction()` selectors, named once because TWO config blocks
// below need them. Flat config does not merge a rule's options: the last block
// matching a file REPLACES them, so a second `no-restricted-syntax` block that
// listed only its own selector would silently switch these three off for every
// file it matched. Spread them into both.
// The design law's four selectors (no raw hex / rgba outside app/landing/), named
// once for the same reason as TRANSACTION_SELECTORS below: the ui-layer and
// import-law blocks further down match the same app/** files, and flat config
// REPLACES a rule's options rather than merging them — so from the day those
// blocks were added, the design-law block's selectors were silently switched off
// for every file they matched (measured 2026-09-01: a bare `bg-[#d6d3d1]` in
// app/_components/ and app/features/ linted clean). Restated in every later block
// that matches app/**; the design-law EXEMPTIONS (landing, brand.ts, glyph and puml
// fixtures, the dev inspector, tests) get trailing blocks of their own that carry
// everything EXCEPT these four, so an exemption stays exempt.
//
// The end-of-hex anchor is `(?![0-9a-fA-F])`, NOT `\b`: `\b` needs a word/non-word
// transition, and Tailwind spells the space inside an arbitrary value as `_`, a word
// character — so `#d6d3d1_0px` inside `[background-image:...]` had no boundary to
// find even where the rule was live. The lookahead only exempts a LONGER hex run.
const DESIGN_LAW_SELECTORS = [
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

// Exactly the design-law block's ignores, single-sourced so the trailing exemption
// blocks below cannot drift from them.
const DESIGN_LAW_EXEMPT_LIB = ["app/landing/**/*.{ts,tsx}", "app/_lib/brand.ts", "app/_dev-inspector/**/*.{ts,tsx}"];
const DESIGN_LAW_EXEMPT_UI = ["app/_components/glyph/glyphs/**/*.{ts,tsx}", "app/_components/puml/**/*.{ts,tsx}"];

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
    "a package importing from app/. packages/** is the portable lane — it is meant to be liftable out of " +
    "this repo, so the dependency only ever points app/ -> packages/. Move the shared value INTO the package " +
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
    // Design law: no hardcoded colors outside app/landing/.
    //
    // ".claude/CLAUDE.md" has always said "Never hardcode colors (bg-[#...],
    // inline style colors, rgba shadows) outside app/landing/ — everything
    // else resolves through tokens", and nothing enforced it. A literal hex
    // cannot follow [data-theme="dark"], so every one of them is a surface
    // that silently stops theming.
    //
    // AST-based on purpose: it sees string literals and template chunks (so
    // `bg-[#fff]`, style={{ color: "#fff" }} and a `rgba(...)` box-shadow all
    // trip) but NOT comments, which legitimately quote hexes when explaining
    // a token. Six-digit only — three-digit `#abc` collides with issue refs
    // and URL fragments, and the codebase's 3-digit hexes are all test data.
    //
    // The companion checks live in scripts/design/check-design-tokens.mjs
    // (brand.ts <-> globals.css lockstep, and dark-mapping parity for every
    // shade utility), wired as `npm run design:check`.
    // ---------------------------------------------------------------------
    files: ["app/**/*.{ts,tsx}"],
    ignores: [
      // Fixed art direction, the one stated exemption in the design law.
      "app/landing/**",
      // The documented JS mirror of the @theme tokens, for surfaces the CSS
      // token system cannot reach (OG card, apple-icon, raw SVG fills). These
      // literals are the point of the file — and design:check now pins every
      // one of them to its --color-* declaration, so they cannot drift.
      "app/_lib/brand.ts",
      // Traced glyph SOURCE data, never painted: MotionizedGlyph runs every
      // fill through snapToToken() (app/_components/glyph/glyphTokens.ts) and
      // emits var(--color-*). ~250 literals that are already tokens by the
      // time they reach the DOM — the best-engineered thing in this cluster.
      "app/_components/glyph/glyphs/**",
      // Diagram-only primitive tints (database cylinder, cloud, sticky note,
      // group boxes) with no CSS-variable equivalent. The brand-mirroring half
      // of the palette now imports from brand.ts; the bespoke half stays
      // literal until the diagram gets a dark register of its own.
      "app/_components/puml/**",
      // Dev-only inspector chrome (DEV_INSPECT=1). Deliberately a FIXED
      // devtools skin that must not follow the app theme — it has to stay
      // readable while you are debugging the theme itself.
      "app/_dev-inspector/**",
      // Test data: hexes here are inputs and expected values for the color
      // sanitizers and the glyph token snapper, not rendered color.
      "app/**/*.test.{ts,tsx}"
    ],
    rules: {
      // The end-of-hex anchor is `(?![0-9a-fA-F])`, NOT `\b`, and that is the whole
      // point of it. `\b` asks for a word/non-word transition, so a hex followed by
      // ANY word character was silently exempt — and Tailwind spells the space inside
      // an arbitrary value as `_`, a word character. That is exactly how
      // `[background-image:repeating-linear-gradient(45deg,#d6d3d1_0px,…)]` sat on the
      // Fit Matrix's blocked cell for months while `npm run lint` and
      // `npm run design:check` both reported clean (design:check delegates the hex gate
      // to this rule). The negative lookahead only exempts a LONGER hex run (an 8-digit
      // #rrggbbaa, which `\b` also let through), so every non-hex follower — `_`, `)`,
      // `;`, a quote, end of string — is now caught.
      "no-restricted-syntax": ["error", ...DESIGN_LAW_SELECTORS]
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
    files: ["app/**/*.ts", "app/**/*.tsx", "scripts/**/*.mjs", "packages/**/*.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...TRANSACTION_SELECTORS]
    }
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
    files: ["app/**/*.ts", "app/**/*.tsx", "packages/**/*.ts"],
    ignores: ["app/**/*.test.ts", "app/**/*.test.tsx", "packages/**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        // Re-stated, not replaced: see the note beside TRANSACTION_SELECTORS.
        ...TRANSACTION_SELECTORS,
        ...DESIGN_LAW_SELECTORS,
        DB_BARREL_SELECTOR,
        // Nobody imports a route handler — true of every layer, so it rides the
        // widest block rather than needing one of its own.
        NO_ROUTE_HANDLER_IMPORT
      ]
    }
  },
  {
    // ---------------------------------------------------------------------
    // The `ui` layer: app/features/** (the tab modules) and app/_components/**
    // (shared primitives). Both are SUBSETS of the block above, so flat config
    // applies this one instead of it — which is exactly the trap the note
    // beside TRANSACTION_SELECTORS describes. Everything the wider block
    // enforces is therefore restated here; adding a selector there without
    // adding it here switches it off for the whole UI layer.
    // ---------------------------------------------------------------------
    files: ["app/features/**/*.ts", "app/features/**/*.tsx", "app/_components/**/*.ts", "app/_components/**/*.tsx"],
    // A test is never compiled into a route and is allowed to drive a store
    // directly to set up its fixture — the same exemption the block above makes.
    ignores: ["app/**/*.test.ts", "app/**/*.test.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...TRANSACTION_SELECTORS,
        ...DESIGN_LAW_SELECTORS,
        DB_BARREL_SELECTOR,
        NO_ROUTE_HANDLER_IMPORT,
        UI_NO_DB_VALUE_IMPORT
      ]
    }
  },
  {
    // ---------------------------------------------------------------------
    // Design-law EXEMPTIONS, restated last so they win: these paths keep every
    // import/transaction selector their layer carries, minus the four design-law
    // ones (landing is a fixed art direction; brand.ts is the token mirror; the
    // glyph/puml fixtures and the dev inspector are documented exemptions). Tests
    // are already exempt: both blocks above ignore them, so the wide transaction
    // block is the last match there. See DESIGN_LAW_SELECTORS.
    // ---------------------------------------------------------------------
    files: DESIGN_LAW_EXEMPT_LIB,
    ignores: ["app/**/*.test.ts", "app/**/*.test.tsx"],
    rules: {
      "no-restricted-syntax": ["error", ...TRANSACTION_SELECTORS, DB_BARREL_SELECTOR, NO_ROUTE_HANDLER_IMPORT]
    }
  },
  {
    files: DESIGN_LAW_EXEMPT_UI,
    ignores: ["app/**/*.test.ts", "app/**/*.test.tsx"],
    rules: {
      "no-restricted-syntax": ["error", ...TRANSACTION_SELECTORS, DB_BARREL_SELECTOR, NO_ROUTE_HANDLER_IMPORT, UI_NO_DB_VALUE_IMPORT]
    }
  },
  {
    // The portable lane. Also a subset of the wide block above, so the same
    // restatement rule applies.
    files: ["packages/**/*.ts"],
    ignores: ["packages/**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...TRANSACTION_SELECTORS,
        DB_BARREL_SELECTOR,
        NO_ROUTE_HANDLER_IMPORT,
        PACKAGES_NO_APP_IMPORT
      ]
    }
  }
];

export default config;
