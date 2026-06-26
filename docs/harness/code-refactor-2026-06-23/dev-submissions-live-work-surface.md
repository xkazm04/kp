> Total: 6 findings (0c critical, 2h high, 2m medium, 2l low)

## 1. `SeedFiles` component is dead — only its `SeedFile` type is still imported
- **Severity**: High
- **Category**: dead-code
- **File**: app/devcase/apply/[token]/SeedFiles.tsx (whole component, lines 13-63)
- **Scenario**: The `SeedFiles` React component is never rendered. `grep -rn "SeedFiles"` across `app/**` returns exactly two hits outside the file itself, and both import only the **type**: `page.tsx:9` (`import { type SeedFile }`) and `LiveWorkSurface.tsx:5` (`import type { SeedFile }`). No JSX `<SeedFiles`, no `SeedFiles(` call, no test render (`grep "<SeedFiles\|SeedFiles("` → empty). The page renders `LiveWorkSurface` for the seed path and `DevApplyForm` otherwise (page.tsx:88-96); `SeedFiles` is in neither branch. The component's own header comment even brags the seed endpoint "had zero callers" — and the component has now joined it.
- **Root cause**: `SeedFiles.tsx` was created in commit `56ae3fa` with the apply page, which originally surfaced the starter tree via this component. The "UAT M9 — ONE submit path" refactor (page.tsx:85-96) replaced it with the editable `LiveWorkSurface`, orphaning `SeedFiles` while leaving the `SeedFile` type it exports still in use.
- **Impact**: ~50 lines of unreachable UI (plus its only-here `downloadFile`/`Download`/`FileCode2`/`useTranslations` imports and a `downloadAll` bundle builder) read as live. Future edits to seed handling may touch it for nothing; the `i18n` keys `seedHeading`/`seedDownloadAll`/`seedDownloadOne` it consumes look load-bearing but aren't.
- **Fix sketch**: Move `export type SeedFile = { path: string; contents: string };` to `app/features/sub_dev/DevTypes.ts` (its natural home, next to `ProcessEvent`), repoint the two type imports in `page.tsx` and `LiveWorkSurface.tsx`, then delete `SeedFiles.tsx`. Verify the three `devApply` seed i18n keys aren't referenced elsewhere before pruning them.

## 2. `/api/devcase/seed/[id]` route has zero callers — the page reads the seed directly
- **Severity**: High
- **Category**: dead-code
- **File**: app/api/devcase/seed/[id]/route.ts (whole route)
- **Scenario**: No source code fetches this endpoint. `grep -rn "api/devcase/seed"` over `app/` + `pipeline/` is empty; the only matches anywhere are generated `.next/*-manifest.json` route registrations. The three `grep` hits for "devcase/seed" in `.ts` files are all **comments** referencing the Python `seed_materializer.py`, not fetches (`core.ts:707`, `devcase.ts:21`, `devcase-run.ts:197`). The apply page that would consume a seed instead reads it straight from the DB server-side: `page.tsx:42 getDevCase(...)` → `:48 devCase?.seed` → `:49 seedFiles`. The route's own comment claims it serves "distribution and the recruiter UI," but neither path calls it.
- **Root cause**: The GET route was added (commit `5261242`) as the intended seed-delivery seam, but every actual consumer ended up reading `devCase.seed` directly through `getDevCase`, so the HTTP indirection was never wired up.
- **Impact**: A live, unauthenticated GET endpoint exposing case seed contents with no caller — dead surface that still must be maintained/secured and can mislead readers into thinking seed delivery is HTTP-mediated.
- **Fix sketch**: Confirm once more there's no external/Python consumer (done here — only build artifacts reference it), then delete `app/api/devcase/seed/[id]/route.ts`. If an HTTP seed seam is wanted later, reintroduce with a caller.

## 3. Live-Surface event-kind allowlist duplicates `ProcessEventKind`
- **Severity**: Medium
- **Category**: duplication
- **File**: app/api/devcase/session/[id]/route.ts:10 (plus app/features/sub_dev/DevTypes.ts:15)
- **Scenario**: The session-append route hardcodes `const KINDS = new Set(["open", "edit", "decision_log", "submit"])` to validate candidate-supplied events. The exact same four strings are the canonical union `ProcessEventKind = "open" | "edit" | "decision_log" | "submit"` in `DevTypes.ts:15`, which `LiveWorkSurface.tsx` (the only producer of these events) already imports via `ProcessEvent`. Confirmed both definitions list the identical members.
- **Root cause**: The route does hand-rolled boundary coercion (its comment says so) and didn't pull the kind set from the shared type, so the producer and the validator carry separate copies of the same enum.
- **Impact**: Adding/renaming a process-event kind requires editing two unlinked places; a drift makes the server silently drop a kind the client emits (the route `.filter`s out unknown kinds). Low blast radius today but a real future-bug seam.
- **Fix sketch**: Export a runtime array beside the type in `DevTypes.ts` (e.g. `export const PROCESS_EVENT_KINDS = ["open","edit","decision_log","submit"] as const;` and derive `ProcessEventKind` from it), then in the route `const KINDS = new Set<string>(PROCESS_EVENT_KINDS)`. Server routes can import `DevTypes.ts` safely (type/const-only, no client deps).

## 4. `DECISIONS.md` filename / "decision_log" mapping duplicated between client and server
- **Severity**: Medium
- **Category**: duplication
- **File**: app/devcase/apply/[token]/LiveWorkSurface.tsx:14,117 (plus authenticity/eval consumers)
- **Scenario**: `LiveWorkSurface` declares `const DECISIONS_FILE = "DECISIONS.md"` (:14) and classifies an edit as `decision_log` when `path.endsWith(DECISIONS_FILE)` (:117). The same "DECISIONS log" contract is independently re-expressed downstream as `decisionsLogPresent` in `devcase-authenticity.ts` (input field, :22) and rendered as a literal "DECISIONS log" badge in `EvalPanel.tsx:152`. The canonical filename string lives only in the client; the server/scoring side relies on a separately-derived boolean.
- **Root cause**: The decisions-log concept grew across layers (capture in the surface, score in authenticity, render in the panel) without a single shared definition of "what counts as the decisions file."
- **Impact**: If the mandated artifact name ever changes (e.g. `DECISIONS.md` → `decisions/`), the client tag and the server's presence check can disagree, silently mis-scoring authenticity. The coupling is implicit and easy to miss.
- **Fix sketch**: Hoist the canonical filename (and ideally a small `isDecisionsLog(path)` helper) into a shared module (e.g. `DevTypes.ts` or a `devcase-constants.ts`) consumed by both the surface and any server path that decides `decisionsLogPresent`. Low priority — flag only; consolidate when the decisions-log logic is next touched.

## 5. `unionChangedPaths` logic is duplicated inline in `repo-snapshot.ts`
- **Severity**: Low
- **Category**: duplication
- **File**: app/_lib/repo-snapshot.ts:206-212 (mirrors app/_lib/devcase-seed-diff.ts:37-45)
- **Scenario**: `fetchRepoSignals` builds `changedPaths` with an inline `Set` + `f.filename.trim().replace(/\\/g, "/").replace(/^\.\//, "")` loop (:206-212) that is a hand-copy of the tested `unionChangedPaths` in `devcase-seed-diff.ts:37-45`. This is **documented as deliberate** (repo-snapshot.ts:5-7 and :203-205): the module is kept import-free so its colocated `node --test` resolves without pulling siblings, and `devcase-seed-diff` "owns the tested copy."
- **Root cause**: A tooling constraint (the Node test runner can't resolve the sibling's transitive imports) drove an intentional copy-paste with a written rationale.
- **Impact**: Two copies of the path-normalization rule can drift (one already differs slightly — seed-diff also lower-cases in `norm`, the snapshot copy does not), but the duplication is small, justified, and bounded. Reporting for completeness, not action.
- **Fix sketch**: Leave as-is unless the import-free constraint is lifted. If a shared zero-dependency util module is ever introduced for these pure helpers, both call sites could point at one `normalizeChangedPath`. Do not consolidate just to remove the copy — it would break the colocated test isolation the comments protect.

## 6. `frameworks` field on `RepoSnapshot` is permanently `[]` by design — verify cross-language need
- **Severity**: Low
- **Category**: dead-code
- **File**: app/_lib/repo-snapshot.ts:13-21,112
- **Scenario**: `RepoSnapshot.frameworks` is always returned as `[]` (`:112`), never populated. The 8-line comment (`:13-20`) documents this as intentional — framework naming is delegated to the LLM, and the field is retained only because the Python pydantic `RepoSnapshot` model (`pipeline/jobfit/devcase/models.py`) carries it for cross-language contract parity. `AnalysisView.tsx` renders `languages`, `topDirs`, `recentCommitSummaries`, `loc` but never `frameworks`, confirming no TS consumer reads it.
- **Root cause**: A reserved contract field kept for JSON-shape symmetry with the Python model rather than deleted.
- **Impact**: Effectively a dead field on the TS side — harmless, but a reader can mistake it for a populated signal. The extensive comment already mitigates this.
- **Fix sketch**: No code change recommended; the cross-language-contract rationale is sound and well-documented. If the Python model ever drops `frameworks`, remove it here too. Flagged only so the "always-empty field" is on the ledger as a known, accepted state, not an oversight.
