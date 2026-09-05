import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });

// ─── The suite owns its database ─────────────────────────────────────────────
// Every spec below writes: token-doors-axe mints an offer and an org invite,
// profile-roster saves and deletes profiles, the journeys move pipeline entries.
// With no KP_DB_PATH the managed webServer opened `data/kp.sqlite` — the
// operator's own developer database — so a local `npm run test:e2e` mutated the
// demo corpus the next `npm run dev` shows, and a spec's leftovers changed what
// the NEXT run measured (the JD ledger's row count, the roster's pager total).
//
// Absolute, because a relative KP_DB_PATH resolves against the SERVER's cwd
// (app/_lib/db-path.ts), which is the launch directory and not necessarily this
// one. Throwaway and gitignored (`data/*.sqlite`): a fresh file self-seeds the
// demo corpus from data/seed_* on first boot, so DELETING IT IS THE RESET —
// that is the supported way to clear whatever the specs accumulated.
//
// TWO HONEST CAVEATS. (1) `reuseExistingServer` is on locally, so a dev server
// already listening on :3101 is used AS IT IS — it has its own KP_DB_PATH (very
// likely none), and this isolation does not retroactively apply to it. (2) When
// KP_E2E_BASE_URL is set the webServer block is dropped entirely and the server
// env is whatever started it; ci.yml's keyless job boots its own against a
// fresh checkout's data/kp.sqlite, which is isolated by being disposable.
const E2E_DB_PATH = path.resolve(import.meta.dirname, "data", "kp-e2e.sqlite");

// KP_E2E_BASE_URL points the suite at an ALREADY-RUNNING app (e.g. a production
// build started with `npm run build && npm run start -- --port 3101`, or a
// remote deployment) instead of letting Playwright boot the dev server. When it
// is set, the webServer block is omitted entirely — Playwright neither spawns
// nor waits for anything; when unset, behavior is exactly the pre-override
// default (dev server on :3101, reused locally, fresh in CI). e2e/dev-auth.ts
// reads the same variable so the entry cookie lands on the right origin.
const overrideBaseUrl = process.env.KP_E2E_BASE_URL;

// ─── The keyless release subset ──────────────────────────────────────────────
// The specs ci.yml's `e2e-keyless` job runs against a production build with NO
// provider env set — the run that certifies "degrades gracefully keyless" as a
// product property. It lived only as eight positional arguments inside a
// workflow `run:` block, so the release gate's contents were invisible from the
// suite itself: a new keyless spec is added by remembering to edit a YAML step,
// and forgetting is silent (it just never runs, green).
//
// Declared here instead, beside the config that shapes the run, and pinned to
// the workflow by scripts/docs/__tests__/keyless-e2e-pin.test.mjs — which fails
// when the two lists diverge IN EITHER DIRECTION. `.claude/CLAUDE.md`'s subset
// line is derived from this array too (it had already drifted: it still named
// app-master-hire, which needs KP_APP_MASTER_REPO_ROOTS and is not in the job).
//
// These are playwright FILE FILTERS, not paths, and they are deliberately named
// one by one rather than by a shared prefix: a filter that widens as files are
// added is how a slow or key-needing spec ends up in the release gate without
// anyone deciding to put it there. `shell.spec`, not `shell` — a bare `shell`
// would ALSO pull in shell-tab-state.spec.ts. That spec is in the gate now, but
// as its own decided entry below: the point of the precise filter is that
// dropping a `shell-something.spec.ts` into e2e/ tomorrow still enrols nothing.
export const KEYLESS_SPECS = [
  "modal-escape",
  "profile-builder",
  "profile-roster",
  "landing",
  "public-pages",
  "shell.spec",
  "journey-role-to-schedule",
  "journey-one-thread",
  // Wave 41: seven specs that already declared themselves keyless and
  // deterministic in their own headers and ran NOWHERE — not in this array, not
  // in ci.yml, not in any package.json script. A spec nobody runs is a spec
  // nobody maintains, and each of these is the only coverage its surface has.
  "activity-detail",
  "analytics-sections",
  "jds-pipeline-column",
  "quality-tables",
  "shell-tab-state",
  "token-doors-axe",
  "locale-smoke"
] as const;

export default defineConfig({
  testDir: "./e2e",
  // A committed `test.only` runs that ONE test, marks every sibling skipped, and
  // exits 0 — so the keyless CI job would print green while the role-to-schedule
  // journey, the modal dismissal contract and the profile-builder round-trip never
  // ran. Latent rather than active (the tree is clean today), but it is the exact
  // shape of silent-green this repo's guards keep being caught by. CI-only, so a
  // local `.only` while iterating still works.
  forbidOnly: !!process.env.CI,
  // A browser end-to-end run has a genuine flake floor a unit test does not —
  // an animation frame, a slow cold-start compile, a race on the one SQLite
  // file. ONE retry in CI, and zero locally: a locally-flaky test is a defect
  // you want to see the first time, while in CI an unretried flake blocks a
  // release on something that was never broken. One, not two: a test that needs
  // two retries is failing, and hiding that is worse than the red build.
  retries: process.env.CI ? 1 : 0,
  // Pinned rather than left to the default (50% of cores) because every spec
  // shares ONE production server and ONE SQLite file in the keyless job. Two is
  // what a 4-core GitHub runner resolves to today, so this changes nothing now
  // — it stops a larger runner from silently raising the concurrency these
  // specs' shared fixture state has never been tested at.
  workers: process.env.CI ? 2 : undefined,
  timeout: 120_000,
  expect: {
    timeout: 30_000
  },
  use: {
    baseURL: overrideBaseUrl ?? "http://localhost:3101",
    trace: "retain-on-failure"
  },
  ...(overrideBaseUrl
    ? {}
    : {
        webServer: {
          command: "npm run dev -- --port 3101",
          url: "http://localhost:3101",
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          // Playwright already merges this over process.env, so these three are
          // inherited anyway. They are named here so the config SAYS which server
          // env the suite depends on (e2e/app-master-hire.spec.ts's header is the
          // long version), and so a future `env:` that stops inheriting can't
          // silently drop them:
          //   KP_OFFLINE               forces the keyless/deterministic path
          //   KP_APP_MASTER_REPO_ROOTS opens the local-path repo-scan allow-list
          //   KP_SECRET                the at-rest key the Personas pk_ is stored under
          // Only forwarded WHEN SET: an unset one must not arrive as "" (an empty
          // KP_OFFLINE would be a truthiness trap waiting to happen).
          env: {
            // Unconditional, unlike the three below: the whole point is that the
            // suite must NOT inherit the operator's database. An outer KP_DB_PATH
            // still wins if it is exported deliberately.
            KP_DB_PATH: process.env.KP_DB_PATH ?? E2E_DB_PATH,
            ...(process.env.KP_OFFLINE ? { KP_OFFLINE: process.env.KP_OFFLINE } : {}),
            ...(process.env.KP_APP_MASTER_REPO_ROOTS
              ? { KP_APP_MASTER_REPO_ROOTS: process.env.KP_APP_MASTER_REPO_ROOTS }
              : {}),
            ...(process.env.KP_SECRET ? { KP_SECRET: process.env.KP_SECRET } : {})
          }
        }
      }),
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
