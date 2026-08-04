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
