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
    ignores: [".next/**", "node_modules/**", "test-results/**", ".claude/**"]
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
      "app/_components/AiDisclosure.tsx",
      "app/offer/**/*.tsx",
      "app/schedule/**/*.tsx",
      "app/apply/**/*.tsx",
      "app/interview/**/*.tsx",
      "app/_components/voice/**/*.tsx",
      "app/features/Workspace.tsx",
      "app/features/WorkspaceNav.tsx",
      "app/features/sub_pipeline/**/*.tsx",
      "app/features/sub_decisions/**/*.tsx",
      "app/features/sub_schedule/**/*.tsx",
      "app/features/sub_library/**/*.tsx",
      "app/features/sub_jobs/**/*.tsx",
      "app/features/sub_match/**/*.tsx",
      "app/features/sub_profile/**/*.tsx",
      "app/features/sub_channels/**/*.tsx",
      "app/features/sub_interview/**/*.tsx",
      "app/features/sub_history/**/*.tsx",
      "app/features/sub_analytics/**/*.tsx",
      "app/features/sub_about/**/*.tsx",
      "app/features/sub_matrix/**/*.tsx",
      "app/features/sub_analyze/**/*.tsx"
    ],
    rules: {
      "i18next/no-literal-string": ["error", { mode: "jsx-text-only" }]
    }
  }
];

export default config;
