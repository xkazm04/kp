import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import i18next from "eslint-plugin-i18next";

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
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/#[0-9a-fA-F]{6}\\b/]",
          message:
            "Hardcoded color. Colors must resolve through tokens so they follow [data-theme=\"dark\"] — " +
            "use a Tailwind token utility, var(--color-*), or app/_lib/brand.ts for stylesheet-less " +
            "surfaces. If the color has no token, add one to app/globals.css (both themes). See docs/design/README.md."
        },
        {
          selector: "TemplateElement[value.raw=/#[0-9a-fA-F]{6}\\b/]",
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
            "Inline rgb()/rgba() color in a template literal. Use a token from app/globals.css. " +
            "See docs/design/README.md."
        }
      ]
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
    // /landing — marketing prototypes for the Kandidate rebrand, intentionally
    // English-only while the art direction is being chosen. Copy lives inline
    // for design iteration speed; when a variant is promoted to the real
    // public face, its strings move into messages/*.json and this carve-out
    // shrinks accordingly.
    files: ["app/landing/**/*.tsx"],
    rules: {
      "i18next/no-literal-string": "off"
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
      // channels-i18n-honesty (main): the Channels tab + Comms Center graduated off
      // their six prototype-stage `no-literal-string` disables — they are held at
      // ERROR so a new hardcoded string cannot quietly re-English the surface. Their
      // files now live under hiring/channels/**, already covered by the glob above.
    ],
    rules: {
      "i18next/no-literal-string": ["error", { mode: "jsx-text-only" }]
    }
  }
];

export default config;
