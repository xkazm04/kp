> Total: 5 findings (Crit/High/Med/Low: 0/0/4/1)

Context: `dev-case-studio-ui` — the recruiter-facing Dev Case studio. 21 scoped files read in full, plus the 4 sibling panels they import (`ProbeStrengthBanner`, `CohortProbePanel`, `CompareSubmissions`, `InterviewKit`) and the 4 `app/_lib/devcase-*.ts` pure helpers behind them (`devcase-cohort/-compare/-probe-audit/-interview-kit`).

Up front, two things I checked and am NOT flagging:
- **The `app/_lib/devcase-*.ts` pure helpers are correctly NOT duplicated.** Each declares its own local structural `ProbeLike`/`SubmissionLike`/`OutcomeLike` and its logic genuinely differs (heatmap vs. matrix vs. audit vs. markdown). The repeated local types are the deliberate import-freeness convention; I confirmed `DevHelpers.test.ts` only works under bare `node --test` because its `DevTypes` import is **type-only** (the test comment says so). No cross-module-import recommendation is made anywhere below.
- `caseToMarkdown` (DevHelpers) is the single probe-safe document builder and is reused by `CaseDetail`, `LifecycleRow`/`ReviewPanel` and the public apply page — that consolidation is already correct.

The findings below are all client-side JSX duplication that can be consolidated into `DevShared.tsx` (a `.tsx` with no colocated test, so a React/value import there is node-test-safe; it must NOT go into the type-only, node-tested `DevHelpers.ts`).

## 1. Covert-probe row markup duplicated across three components
- **Severity**: Medium
- **Category**: duplication
- **File**: `app/features/sub_dev/CaseDetail.tsx:126-133` (internal probe list) + `app/features/sub_dev/AnalysisView.tsx:168-173` (design preview probes) + `app/features/sub_dev/LifecycleRow.tsx:231-237` (ReviewPanel internal probes)
- **Evidence**: All three render the same probe shape — an uppercased kind chip (`(p.kind ?? "probe").replace(/_/g, " ")`) + `@ {p.where}` + `{p.reveals}`. Grep `rg -n 'p\.kind \?\? "probe"|@ \{p\.where\}'` over `app/features/sub_dev` returns exactly these three call sites (CaseDetail:130/132, AnalysisView:171, LifecycleRow:233-234). CaseDetail additionally renders the lettered `decisionSpace` (A./B./...) below it; AnalysisView and LifecycleRow render only the one-liner. There is no existing shared `ProbeRow`/`ProbeChip` component (grep `ProbeRow|ProbeChip` finds none). The chip class strings drifted slightly (amber tint in CaseDetail/AnalysisView vs. stone tint in LifecycleRow), which is exactly the kind of accidental divergence a shared component prevents.
- **Impact**: A change to the internal probe presentation (or a new field like `decisionSpace` everywhere) means editing three files and reconciling three near-identical class strings; the tint already diverged.
- **Fix sketch**: Add a `ProbeRow({ probe, showDecisionSpace }: { probe: CoverProbe; showDecisionSpace?: boolean })` to `DevShared.tsx` rendering the kind chip + `@where — reveals` (and the lettered decisionSpace when asked). Replace the three blocks. `CoverProbe` is already exported from `DevTypes` and imported as a TYPE here, so this stays node-test-safe (DevShared has no `.test`). NOTE: keep the per-call tint as a prop if the amber-vs-stone difference is intentional; do not force one.

## 2. Rubric-dimension chip rendered identically in two places
- **Severity**: Medium
- **Category**: duplication
- **File**: `app/features/sub_dev/AnalysisView.tsx:180-184` and `app/features/sub_dev/CaseDetail.tsx:155-159`
- **Evidence**: Byte-identical inner markup `{d.label ?? d.name} <span className="text-steel">{formatFraction(d.weight ?? 0, { label: "rubric weight" })}</span>`. Grep `rg -n 'd\.label \?\? d\.name'` over `app/features/sub_dev` returns exactly these two lines. Only the wrapper chip class differs (`bg-paper` in AnalysisView vs. `bg-white ring-1 ring-amber-200/70` + a `title={d.description}` in CaseDetail).
- **Impact**: The rubric-weight rendering contract (the `formatFraction` range guard + label) is copied; a change to how weights display has to be made twice and the two could silently diverge.
- **Fix sketch**: Add a `RubricChip({ dim, tone }: { dim: RubricDim; tone?: "paper" | "amber" })` to `DevShared.tsx` (or accept a `className`), preserving CaseDetail's `title={dim.description}`. Replace both `.map(...)` bodies. `RubricDim` is a type-only import — node-test-safe.

## 3. Follow-up question rendering duplicated between EvalPanel and InterviewKit
- **Severity**: Medium
- **Category**: duplication
- **File**: `app/features/sub_dev/EvalPanel.tsx:204-216` and `app/features/sub_dev/InterviewKit.tsx:70-80`
- **Evidence**: Both iterate `followups.questions`, filter/skip empty text, and render `{n}. {question}` with a muted "Listen for: …" line and a coral "Red flag: …" line. Grep `rg -n 'Listen for|Red flag'` over `app/features/sub_dev` returns both files' pairs (EvalPanel:209/212, InterviewKit:77/78). The two differ only in container (an `<ol>` vs. `<li>` cards) and EvalPanel additionally shows the `[decision]` prefix. Note the *markdown* form of this same kit already lives in the pure, tested `app/_lib/devcase-interview-kit.ts` — so the React form is the only un-shared copy.
- **Impact**: The interviewer-internal "listen for / red flag" presentation (a sensitive must-never-be-candidate-facing distinction) is maintained in two components; a styling or labelling fix can land in one and miss the other.
- **Fix sketch**: Add a `FollowupQuestionItem({ q, index, showDecision }: { q: FollowupQuestion; index: number; showDecision?: boolean })` to `DevShared.tsx` rendering the question + the two internal-note lines; use it inside both the EvalPanel `<ol>` and the InterviewKit `<ol>`. `FollowupQuestion` is exported from `DevTypes` (type-only import) — node-test-safe.

## 4. Lifecycle "live stages" set duplicated as an inline literal
- **Severity**: Low
- **Category**: duplication (structure)
- **File**: `app/features/sub_dev/LifecycleRow.tsx:32` and `app/features/sub_dev/CasesTable.tsx:14`
- **Evidence**: The same stage set `["published", "collecting", "ranked", "promoted"]` is hand-written in both files — in LifecycleRow it gates the "Close case" button (`closable`), in CasesTable it picks the moss "live" stage tint. Grep `rg -n '"published", "collecting", "ranked", "promoted"'` over `app/features/sub_dev` returns exactly these two. `DevTypes.ts` already centralises stage metadata (`LIFECYCLE_STEPS`, `STAGE_LABEL`) right beside these, so the home for this constant already exists.
- **Impact**: Adding/removing a post-publication stage (e.g. a future "interviewing") requires finding both copies; the two could fall out of sync, so a stage reads "live" in the table but isn't closable (or vice-versa).
- **Fix sketch**: Add `export const LIVE_STAGES = ["published", "collecting", "ranked", "promoted"] as const;` to `DevTypes.ts` and reference it (`LIVE_STAGES.includes(stage)`) from both call sites. Pure data in the type module — no test impact.

## 5. Legacy capability-fallback metadata is dead for current evaluations and risks drift
- **Severity**: Low
- **Category**: cleanup (dead-ish code / structure)
- **File**: `app/features/sub_dev/EvalPanel.tsx:12-18,45-48`
- **Evidence**: `LEGACY_LABELS` (framing/tooling/judgment/architecture/transfer) and the `Object.keys(LEGACY_LABELS).map(...)` branch exist only to render `dimensionScores` bundles saved before `e.dimensions` existed (the type comment in `DevTypes.ts:124-133` confirms `dimensions` is now the canonical, self-describing, weight-annotated projection and `dimensionScores` is "the single source of truth … fallback only for bundles saved before it"). For any current evaluation `e.dimensions` is populated, so this map is never read. I am NOT calling it removable (it is a real backward-compat fallback for old persisted bundles, used dynamically — so it has live references and fails the zero-reference bar), but the hardcoded label list duplicates dimension metadata the engine now emits, which the rest of the file deliberately avoids.
- **Impact**: Low — purely a latent-drift / clarity cost: if the Python rubric renames an axis, this stale label map silently mislabels old bundles, and a reader can mistake it for current behaviour.
- **Fix sketch**: Leave the fallback (do not delete — it serves legacy bundles), but add a one-line comment that this path only fires for pre-`dimensions` bundles, OR derive the fallback label from the key (`name.replace(/_/g," ")` title-cased) instead of a hardcoded 5-entry map, dropping the duplicated metadata. Keep `dimensionScores` as the value source. No node-test concern (EvalPanel is a `.tsx`, untested).
