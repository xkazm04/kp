# Analysis Result Panels — bug-hunter + ui-perfectionist scan

> Context: The tabbed presentation of a completed analysis — extraction/score, salary gauge, job-fit chips, interview kit, soft signals, and compare — the surface a recruiter reads to make a hiring call.
> Files reviewed: 20 of 25
> Total: 5

## 1. FactorChart bars have no fixed Y-domain, so a weak breakdown paints full-height

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-wrong-result
- **File**: `app/_components/FactorChart.tsx:37-71` (YAxis at :56; per-factor `max` at :37-43)
- **Scenario**: A candidate whose five components are all low (e.g. experience 8/25, skills 7/30, role 6/23, education 3/12, traits 2/10) opens the "Score breakdown". The recharts `<YAxis>` carries no `domain`, so it auto-scales to the *largest bar value* (~8), not to 30 or 100 — the experience bar reaches the top of the chart. A recruiter reads the tallest, top-filling bar as "maxed out" while the real figure is 8/25 (weak). The truthful number lives only in the hover tooltip and the bar color.
- **Root cause**: The chart plots raw points on a single shared, data-relative axis while each factor has a *different* ceiling (25/30/23/12/10). Height therefore encodes neither achievement (color does that) nor a comparable scale — and because the domain floats per candidate, two candidates' charts can't be compared by eye either.
- **Impact**: The dominant visual on the score-breakdown panel systematically overstates weak candidates and understates the top-weighted factors; a misread here is a hiring-decision harm.
- **Fix sketch**: Give `<YAxis domain={[0, 30]}>` a fixed max (the largest component ceiling) so height is stable and comparable, or — better — plot `value/max` ratios on a fixed `[0,1]` axis and keep the raw "N/max" in the tooltip, so height and color tell one story.

## 2. ArchetypeBanner shows a definite "confidence 0% · completeness 0%" when those fields are absent

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: validation-gap
- **File**: `app/_components/results/ArchetypeBanner.tsx:40-44,76-77`
- **Scenario**: `v2Profile` is a loose `Record<string, unknown>` cast to `V2`; the only render guard is `if (!v2.archetype) return null`. An analysis that carries an archetype but a missing/undefined `archetypeConfidence` (the field is `?`-optional, and any camelCase/alias drift yields `undefined`) renders `Math.round((undefined ?? 0) * 100)` → the chip reads **"confidence 0%"** and **"completeness 0%"**.
- **Root cause**: `?? 0` conflates *absent* with a real zero, and an absent confidence is then displayed as maximal certainty-against. The raw `* 100` also bypasses the `assertFraction`/`formatFraction` range guards that `format.ts` built for exactly this domain (a 0..100 value mis-emitted as a fraction would render "8500%").
- **Impact**: A recruiter reads "0% confidence" as "the engine is sure this archetype is wrong" (or "this profile is empty") when the value was simply never supplied — an inverted signal on the archetype verdict.
- **Fix sketch**: Only render each chip when the field is present (`typeof v2.archetypeConfidence === "number"`), else omit or show "—"; route the value through `formatFraction(v2.archetypeConfidence, { label: "archetypeConfidence" })` so absence and out-of-range both fail safe.

## 3. ScoreDial's hero band label and aria-label are hardcoded English in a bilingual report

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: a11y
- **File**: `app/_components/ScoreDial.tsx:27-33,96,147`
- **Scenario**: A Czech report opens on Extraction or Job-fit. The most prominent element — the score dial — prints the band word ("Early"/"Developing"/"Solid"/"Strong"/"Excellent") under the number, and announces `aria-label="Score 72 out of 100, Strong"` — both hardcoded English, while every surrounding panel is Czech.
- **Root cause**: `BANDS` labels and the `aria-label` template are module literals; `ScoreDial` never calls `useTranslations`. The 2026-06-20 scan fixed FactorChart's identical i18n gap but the dial was missed, so the hero verdict word (and its screen-reader announcement) still flips to English.
- **Impact**: Mixed-language on the single most-read figure; the SR announcement is English-only for cs/de/fr users. Unprofessional on the artifact a hiring manager receives.
- **Fix sketch**: Move the five band labels to `messages.report.scoreBands.*`, thread `useTranslations("report")` into `ScoreDial`, and template the aria-label (`t("scoreAria", { score, band })`).

## 4. SalaryGauge "Mid" / "+30%" tick labels are hardcoded English and the "+30%" is inaccurate after rounding

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: visual-consistency
- **File**: `app/_components/results/salary/SalaryGauge.tsx:102-115`; target rounded at `app/_components/results/salary/SalaryTab.tsx:18`
- **Scenario**: On a Czech salary panel the two markers under the gauge read "Mid" and "+30%" in English. Worse, the caller passes `target = Math.round((midpoint * 1.3) / 5000) * 5000` — for a midpoint of 41 000 the target is 55 000, which is **+34%**, yet the marker is labeled "+30%".
- **Root cause**: The tick labels are literal JSX strings (no `useTranslations`), and the "+30%" caption is a fixed string decoupled from the actual (rounded) `target` the marker sits at, so the label and the position it points to disagree.
- **Impact**: A mixed-language gauge plus a growth marker whose percentage caption can be several points off the figure it marks — a small but real number-vs-label mismatch on a compensation read.
- **Fix sketch**: Localize both labels (`messages.report.salary.mid` / `growthTarget`), and either derive the caption from the real delta (`+{round((target/midpoint-1)*100)}%`) or drop the "%" and label it "Target" to match the rounded figure the card already shows.

## 5. [STILL-OPEN] Compare table lacks caption/scope/row-headers and signals the winner by color only

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: a11y
- **File**: `app/_components/results/compare/CompareTab.tsx:95-164` (row label `<td>` at :250; column `<th>` at :102-114; winner styling at :104-109)
- **Scenario**: A screen-reader or color-blind recruiter reads the CV-variant comparison. Still open from 2026-06-20 #6: the table has no `<caption>`, the column `<th>`s carry no `scope="col"`, each metric row's label is a `<td>` (not `<th scope="row">`), and the winning column is conveyed only by `text-coral` + `bg-limewash` plus an `aria-hidden` `<Crown>`.
- **Root cause**: The surrounding CompareTab was localized since the last scan, but its table semantics and the color-only "winner" affordance were not addressed (WCAG 1.3.1 header association / 1.4.1 use of color). It still matters because Compare is the tab a recruiter uses to *pick* a variant — the one place the accessible "which won" signal is load-bearing.
- **Fix sketch**: Add an sr-only `<caption>`, `scope="col"` on header cells, promote each row label to `<th scope="row">`, and add sr-only "Winner" text (or a visible non-color marker) to the crowned column.
