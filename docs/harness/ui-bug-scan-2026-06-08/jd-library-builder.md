# JD Library & Builder — UI+Bug combined scan
> Total: 4 findings (0 crit / 1 high / 2 med / 1 low)
> Group: Jobs & Job Descriptions | Lens mix: 3 bug / 1 ui | Files read: 13

## 1. Editing Title/Company after generation silently saves a stale body (template path)
- **Severity**: High
- **Lens**: 🐛 Bug
- **Category**: Stale state / silent data mismatch on the common save path
- **File**: `app/features/sub_library/JdBuilderResult.tsx:68` (with `app/features/sub_library/JdBuilder.tsx:74-101,263`)
- **Scenario**: User generates a JD with a template selected (the default: `loadTemplates` auto-selects the default template at `JdBuilder.tsx:59`, so the template render path is active out of the box). After the result appears, the user fixes a typo in the **Role title** or **Company** input (lines 211-214, never disabled). `displayResult` (the `useMemo` at `JdBuilder.tsx:74`) recomputes a fresh `markdown` because `title`/`company` are deps, and the new heading/`**company**` line is rendered. But `JdBuilderResult` is keyed only by `templateId` (`JdBuilder.tsx:263`), so it does **not** remount, and its internal `const [markdown, setMarkdown] = useState(result.markdown)` (line 68) only reads `result.markdown` at mount — there is no effect resyncing the prop on change. The preview/edit textarea and the `save()` body therefore keep the OLD title/company text.
- **Root cause**: `markdown` is mount-only derived state; the parent feeds a recomputed `result.markdown` via props but nothing re-seeds the child state, and the remount key (`templateId`) doesn't change when only title/company change.
- **Impact**: The published/saved JD body, the ingested structured Job, and the public `/jds/[slug]` page show the pre-correction title/company even though the form on screen shows the corrected values — a confusing, silent content mismatch on a primary path. The user only notices after the JD is live.
- **Fix sketch**: Either re-seed on prop change — `useEffect(() => { setMarkdown(result.markdown); setEdited(false); }, [result.markdown])` (guard against clobbering genuine hand-edits, e.g. only resync when `!edited`) — or include `title`/`company` in the remount key alongside `templateId`. Note the dirty-guard in JdBuilder only protects *template switches*, not title/company edits, so this gap is unguarded today.

## 2. Template-rendered salary shows "/ mo" while every other JD path shows "/ month"
- **Severity**: Medium
- **Lens**: 🐛 Bug (content correctness) / 🎨 consistency
- **Category**: Inconsistent rendered output across the two JD render paths
- **File**: `app/features/sub_library/JdBuilder.tsx:89`
- **Scenario**: `formatSalaryRange` echoes the `period` string verbatim — `return options.period ? \`${range} / ${options.period}\` : range` (`app/_lib/format.ts:53`). The template render path passes `period: "mo"` (`JdBuilder.tsx:89`), so a JD built **through a template** prints e.g. `120k–150k CZK / mo`. The AI-default path (`composeMarkdown`, `app/_lib/jd-build-run.ts:82`) passes `period: "month"`, printing `… / month`. So the same product emits two different salary suffixes depending on whether a template is selected, and the value is baked into the saved/published JD body text.
- **Root cause**: A hard-coded literal `"mo"` at one of two call sites; `period` is a free-form passthrough with no shared constant, so the two paths drifted.
- **Impact**: Inconsistent, slightly unprofessional salary wording on public JD pages; differs from the rest of the app's "month" convention. Low blast radius but it ships to candidates.
- **Fix sketch**: Use `period: "month"` at `JdBuilder.tsx:89` (or extract a shared `SALARY_PERIOD` constant referenced by both call sites) so the rendered suffix matches `composeMarkdown`.

## 3. Template name input and body textarea have no accessible name (and duplicate the JD form's pattern without its labels)
- **Severity**: Low
- **Lens**: 🎨 UI Perfectionist (accessibility / forms)
- **Category**: Missing form label / accessibility gap + inconsistent form pattern
- **File**: `app/features/sub_library/JdTemplateManager.tsx:101-114`
- **Scenario**: The template editor's name `<input>` (line 101) and body `<textarea>` (line 108) carry only a `placeholder` ("Template name") and no `<label htmlFor>`, `aria-label`, or `aria-labelledby`. The placeholder disappears on first keystroke and is not a programmatic accessible name, so a screen-reader user editing a template hears an unlabeled "edit text" with no field identity — and on an in-place edit the fields are pre-filled, so there is no placeholder at all. This is the same name/body editor as `LibraryJdForm.tsx` (lines 65-88), which *does* use proper `<label htmlFor="jd-title">` / `<label htmlFor="jd-body">`, so the manager both regresses a11y and diverges from the established pattern.
- **Root cause**: Editor fields rely on placeholder-as-label; no `<label>`/`aria-label` wiring, unlike the sibling JD form.
- **Impact**: Forms a11y failure in the template manager (assistive tech can't name the two primary fields); inconsistent with the rest of the library UI.
- **Fix sketch**: Add `aria-label="Template name"` / `aria-label="Template body"` (or visible `<label htmlFor>` like LibraryJdForm) to the two controls; ideally extract the shared name+body editor so JD form and template manager can't drift on labeling.

## 4. Template manager flashes an empty bordered list with no loading/empty state
- **Severity**: Low
- **Lens**: 🎨 UI Perfectionist (missing states)
- **Category**: Missing loading + empty state
- **File**: `app/features/sub_library/JdTemplateManager.tsx:13,20-23,138-191`
- **Scenario**: On open, `templates` initializes to `[]` (line 13) and `load()` fetches asynchronously (lines 20-23). Until it resolves, the list branch (lines 138-191) renders an empty `<ul>` — a bare bordered box with only the "New template" button — then templates pop in. There is also no distinct empty-state copy: an empty list (e.g. if `fetchTemplates` swallows an error to `[]`, see `render-template.ts:243-250`) looks identical to "still loading", so a failed/empty fetch is indistinguishable from a slow one. (The store always seeds one template, so truly-empty is rare, but the swallow-to-empty fetch makes it reachable on error.)
- **Root cause**: No loading sentinel (e.g. `templates === null`) and no empty/error branch; the component treats "not yet loaded" and "loaded zero" the same.
- **Impact**: Brief empty-box flicker on every open; on a fetch failure the user sees a silently empty manager with no explanation or retry. Polish-level but affects every manager open.
- **Fix sketch**: Initialize to `null`, render a small skeleton (mirror `JdListSkeleton` in LibraryTab) while loading, and add an explicit empty/error message with a retry when `load()` returns no rows or throws.
