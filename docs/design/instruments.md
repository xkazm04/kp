# Style and render instruments

Four tools measure every kit-unification gate. They write only to the directory
you name (or `test-results/`), never commit anything, and never touch the
operator's server or `data/kp.sqlite`. Re-run them at each gate; never quote an old
number.

| Tool | Command | Answers |
| --- | --- | --- |
| Page shots | `npm run style:shoot -- --out <dir> [targets]` | What a surface visibly does, in both themes, at three frames |
| Divergence | `npm run style:divergence` | Which module drifts most from the recipes and the type scale |
| First load | `npm run perf:first-load` | How much first-party client code a surface ships before any lazy chunk |
| Web vitals | `npm run perf:vitals` | How fast a surface paints and settles in a real browser |

## The gate sequence

1. **Before shots** of the gate surface: `npm run style:shoot -- --out tmp/g1/before channels`.
   Keep the directory: its `kp-snapshot.sqlite` is the data the AFTER half must use.
2. **Build** the change: `npm run build` (the shots and vitals serve `.next`).
3. **After shots on the same rows**: `npm run style:shoot -- --out tmp/g1/after --db tmp/g1/before/kp-snapshot.sqlite channels`.
4. **Pair**: `npm run style:shoot -- --pair tmp/g1/before tmp/g1/after --out tmp/g1/pair`, then open the composites.
5. **Divergence delta**: `npm run style:divergence -- --module features/hiring/channels`, before and after.
6. **First-load delta**: `npm run perf:first-load -- --target channels`, before and after.

## Surfaces: `scripts/style/targets.json`

Each named surface has a `path`, a `root` selector that must mount, and optional
`{placeholders}` resolved by a documented read-only query against the data copy.
Gate surfaces: `settings-hiring`, `channels`, `offer`, `skill`, `journey`, `history`.
Reference-quality surfaces: `analytics`, `me`. The demo corpus has no evaluated
dev-case submission, so `skill` carries a `seed`: it inserts one fixture submission
into the THROWAWAY copy and mints the credential through `POST
/api/devcase/skill-profile`, the real signing path.

## 1. Page shots: `scripts/style/shoot.mjs`

**What it does.** It copies the database with SQLite's online backup (WAL-safe, the
source opened read-only) to `<out>/kp-snapshot.sqlite`, then copies that again to a
throwaway file. It starts `next start` over the current `.next` build on a free port,
in open mode, with `KP_OFFLINE=1`. It shoots each target at `1280x800`, `1728x1080`
(kp's frame) and `1440x3200` (tall, so the lower half is judged too), in `light` and
`dark`. Output is `<target>-<W>x<H>-<theme>.png`, plus `shoot-report.json` (problems,
root height, text length, the browser build, the frozen clock). The server is killed
by PID on exit.

- **Theme.** `localStorage kp-theme` is set before load; the shot fails unless
  `html[data-theme]` matches the theme asked for.
- **Stillness.** Reduced motion, CSS animations disabled, a UTC timezone, and the
  browser clock frozen at the snapshot's minute. The AFTER run reuses the frozen
  clock from the snapshot's report. The first render of a run is discarded, and each
  shot waits until two consecutive frames match.
- **Fails loud (exit 1).** The run fails on any console error or uncaught page error,
  and on any `/api` request that answers 400 or more or fails outright. It fails when
  the document answers 400 or more, or the theme does not match. It also fails on an
  **empty mount**: the root is absent, shorter than `minHeight`, or holds fewer than
  `minText` characters. It waits until the root's text has stopped growing for three
  reads, because a length test alone passed on a tab header while the body streamed.
- `npm run style:shoot -- --self-test` starts one server and proves each failure mode
  fires for its own reason (an unknown target, a missing root, a forced console
  error, a 404 from `/api`). It also requires a green control shot.
- `--dry-run` prints the plan and the resolved paths without a server or a browser.
- `--pair <before> <after> --out <dir>` writes side-by-side composites with a label
  strip and the changed-pixel share, plus `pair-report.json`. It refuses shots from
  two browser builds (`--allow-browser-drift` overrides). A re-run of unchanged code on
  the same snapshot measured 0% on 11 of 12 views and 0.001% (40 px of anti-aliasing)
  on one. Treat anything under 0.01% as renderer noise.
- Options: `--sizes`, `--themes`, `--settle <ms>`, `--db <sqlite>`, `--clock <iso>|off`,
  `--server dev` (a `next dev` on `.next-empty`, only when `npm run dev:empty` is not
  running), and `--base-url <url>` (reuse a server; `--db` then names its database,
  read-only, and seeds are refused).

**What it cannot see.** Server-rendered times follow the server's clock, so a date
printed by the server (the skill card's "Issued") moves between days. A
`position: fixed` element (the Candi orb) is painted where the viewport put it, even
inside a full-page shot. The shots show `.next`, so a stale build shows stale code;
the tool warns when `.next` is older than HEAD.

**If the build is red.** When a sibling's in-flight work breaks `tsc`, `next build`
stops and wipes `.next`. For shots only, build without the type check:
`npx next build --experimental-build-mode compile && npx next build --experimental-build-mode generate`.

## 2. Divergence: `scripts/style/style-divergence.mjs`

It reads every non-test `.tsx` under `app/`, except the marketing surfaces
(`app/landing`, `app/about`, `app/market`). It groups them into modules:
`features/<area>/<module>`, `_components/<x>`, or `/<route>`. Per file it counts:

- `handButtons`: a `<button>` with no recipe or kit class
- `offScale`: `text-(xs|lg|xl|2xl|3xl)` or an arbitrary `text-[Npx]`
- `rawScale`: `text-sm` or `text-base`, which are on the floor and reported but not weighted
- `approved`: the named scale, `text-(meta|body|micro|h1|h2|h3|display)`
- `rawStone`: `text-stone-N`
- `statusHue`: a raw status hue on `text-`, `bg-` or `border-`
- `recipeDebt`: the file's ceilings in `recipe-debt.json`
- `recipeImports`

**index** = weighted drift per 100 LOC minus 0.25 x recipe imports per 100 LOC, floored
at 0. The weights are `handButtons 1, offScale 2, rawStone 1, statusHue 1, recipeDebt 1`.

`--json` prints every module and file, `--module <key>` prints one module's files, and
`--top N` limits the table. On Git Bash, pass a route module without its slash
(`--module skill`), or MSYS rewrites it into a Windows path.

**Against the scout's hand index (2026-09-25).** The mean absolute error over 13
modules is 0.80, and the top and bottom tiers match:

| Module | Scout | Tool |
| --- | --- | --- |
| settings/hiring | 4.80 | 3.40 |
| matrix | 4.45 | 3.47 |
| /skill | 4.25 | 6.44 |
| channels | 3.67 | 3.04 |
| /history | 3.33 | 3.30 |
| /jds | 3.20 | 2.39 |
| journey | 3.08 | 2.74 |
| devcases | 3.02 | 2.21 |
| gigs | 4.67 | 2.52 |
| analytics | 0.96 | 0.58 |
| jobseeker | 0.31 | 0.00 |
| /apply | 0.10 | 0.03 |
| voice | 0.00 | 0.28 |

Three rows differ in a way worth knowing:

- **/skill reads high.** It is 264 LOC, so ten raw status hues move it by 4 points.
  Small route modules are noisy.
- **gigs reads low.** It was rebuilt the day the tool was calibrated, after the scout
  had counted it.
- **settings/hiring ranks fifth, not first.** Its drift is mostly status hues on the
  impact cards, and the tool weights those at 1.

**What it cannot see.** It sees neither a class built at runtime nor a recipe that
is itself off-scale. It cannot tell what a surface looks like, so pair it with shoot.

## 3. First load: `scripts/perf/first-load.mjs`

`check-budget.mjs` walks static and dynamic imports, including server code, so moving a
panel behind `next/dynamic` changes nothing there. This walk follows static imports
only, and it counts only client code. A `'use client'` module and its static closure
count. A module reached from a server component stays server: it is followed, but not
counted. A `'use server'` module is a boundary: it is stubbed, listed, and not
followed. `import()` is never followed. The resolver and import readers are the ones
in `check-budget.mjs`.

It reports the shell (`Workspace.tsx`), every `TAB_CHUNKS` entry, `/`, and each gate
route's page, with client modules, KB of first-party source, and the third-party
packages reached (names only). Flags: `--json`, `--target <tab|route|shell>`, and
`--explain <entry>` for the 20 heaviest client modules. It is report-only, with no
ceilings yet. `node scripts/perf/__tests__/first-load.test.mjs` is its fixture, and
it runs in `npm run test:perf`.

**What it cannot see.** It measures source bytes, not minified or gzipped bytes. It
sees no tree-shaking, no CSS, and nothing inside a package. A route's layout is not
counted, only its page.

## 4. Web vitals: `e2e/perf-vitals.spec.ts`

`npm run perf:vitals` wraps the spec in `scripts/style/serve.mjs`. The wrapper keeps the
same throwaway-server rule: a copy of the data, `next start` over `.next`, the targets
resolved (seeds included), and the server killed by PID. The spec is skipped unless
`KP_PERF_VITALS=1`, and it is not a CI gate. `KP_PERF_TARGETS=channels,offer` narrows
it.

For each surface it measures a **cold** load in a fresh context: TTFB, FCP, LCP,
total long-task ms, JS transferred, and time-to-content. Time-to-content is the
moment the target root holds its content with no skeleton. For a workspace tab it
also measures a **warm** switch from a sibling tab in the same nav group: long tasks,
JS fetched, and time-to-content after the click. It writes
`test-results/perf-vitals/<ts>.json` and prints a table.

**What it cannot see.** Headless Chromium on the build machine is not a user's
laptop, and one run is one sample. Tabs the shell warms on idle (`IDLE_WARM` in
`tabChunks.ts`) fetch no JS on a warm switch, which is correct and is not a
regression. Time-to-content is read in the frame before paint, so it can land a few
ms before FCP.
