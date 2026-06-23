> Total: 6 findings (0c critical, 0h high, 3m medium, 3l low)

## 1. `DIAGRAM_STATUS_TOKENS.gap.dashed` is a dead field — both consumers hard-code the dashed look
- **Severity**: Medium
- **Category**: dead-code
- **File**: app/_components/puml/constants.ts:40 (also the `dashed?: boolean` in the type at :36)
- **Scenario**: The token map declares `gap: { fill, stroke, dashed: true }` and the type carries `dashed?: boolean`, with a comment ("`dashed` flags the gap state, which renders with a dashed border in both") promising it is the single source of the dashed treatment. But grep for the only thing that could read it — `grep -rn "\.dashed\|DiagramStatus" app/` — returns just the *declaration* sites in constants.ts. The two actual consumers ignore it: `componentStyle` in PlantUml.tsx:153 hard-codes `dash: true`, and the legend swatch in page.tsx:79 hard-codes the `border-dashed` className. So the field is written, documented as load-bearing, and never read.
- **Root cause**: When the tokens were single-sourced (`d4b265b refactor(diagrams): single-source the status color tokens`) the fill/stroke were centralized but the dashed decision was left duplicated in both renderers; the `dashed` field was added "for completeness" and never wired.
- **Impact**: Misleading — a future edit that flips `gap.dashed` to `false` to make the gap solid would silently do nothing (the border stays dashed in both places), the exact drift the constants file claims to prevent. Dead surface that lies about being authoritative.
- **Fix sketch**: Either (a) consume it — `componentStyle` returns `dash: DIAGRAM_STATUS_TOKENS[...].dashed` and the legend reads it to choose `border`/`border-dashed`; or (b) delete the `dashed` field + its type slot + the "renders with a dashed border in both" sentence, since the dashed look is intrinsic to the gap state anyway.

## 2. The leaf `folder` shape (`Folder` component + `case "folder"`) is never reachable
- **Severity**: Medium
- **Category**: dead-code
- **File**: app/_components/puml/PlantUml.tsx:116-125 (`Folder`), :223-229 (`case "folder"`); declared in parse.ts LEAF_KEYWORDS:80-86 and sizeLeaf layout.ts:61-62
- **Scenario**: A leaf `folder` node only renders when a source has `folder "X" [as id]` **without** a trailing `{`. grepping every source the renderer can be fed — the 3 wired diagrams (01/02/15), the inline STEP_DETAILS, all 15 docs/diagrams/*.puml, and every `.md` (the Markdown.tsx path) — finds zero leaf folders: `grep -rn 'folder "' docs/diagrams/*.puml` only matches `folder "data/" as datafiles {`, which is a *container* open (routes to `renderContainer`, not `Folder`). The parser's own header (parse.ts:17-21) brags that "speculative kinds that rendered identically to a generic box ... were pruned so the parser surface matches the renderer's real capabilities" — yet `folder` leaf was kept while unused, contradicting that contract. Unlike actor/cloud/database/note (all exercised), the leaf-folder path is dead end-to-end.
- **Root cause**: `folder` is both a container keyword and a leaf keyword; the pruning pass that trimmed leaf kinds kept `folder` to mirror the container keyword, but no diagram declares a leaf folder.
- **Impact**: Carries a distinct SVG shape, a sizeLeaf branch, and a parser keyword for a capability nothing uses — drift against the file's stated "honest subset" principle, and one more shape to maintain/test.
- **Fix sketch**: If leaf folders are genuinely never authored, drop `folder` from `LEAF_KEYWORDS`, delete the `Folder` component + `case "folder"` + the sizeLeaf `case "folder"`, and add a `pruned leaf keyword` test row for `folder` (parse.test.ts already pins `interface/queue/node` this way). If it's intended future capability, add a kept-leaf test row so it's at least covered — currently it isn't.

## 3. `componentStyle` matches stereotype synonyms no source ever emits
- **Severity**: Low
- **Category**: dead-code
- **File**: app/_components/puml/PlantUml.tsx:150-153
- **Scenario**: The gate branch matches `/gate|human|review|approval|manual/` and the gap branch `/todo|planned|gap|missing|future|build/`. grepping every stereotype across the wired diagrams + STEP_DETAILS (`grep -roh '<<[^>]*>>' ...`) yields exactly four: `<<auto>>`, `<<v2>>`, `<<gate>>`, `<<gap>>`. So `human|review|approval|manual` and `todo|planned|missing|future|build` are never hit by committed content. (Mild mitigation: Markdown.tsx feeds the renderer arbitrary AI/user-authored puml, so a synonym *could* appear there — which is why this is Low, not dead-for-sure.)
- **Root cause**: Defensive synonym lists added speculatively when the trichotomy was generalized.
- **Impact**: Minor — extra regex alternatives that look like supported vocabulary but have no tests and no authored usage; a reader can't tell which tokens are real.
- **Fix sketch**: Either trim to the tokens actually used (`gate`, `gap`/`build` for the two non-default states) or, if the synonyms are intentional for free-form Markdown puml, add a one-line test asserting e.g. `<<review>>`→gate and `<<planned>>`→gap so the intent is pinned rather than incidental.

## 4. `note ... over` syntax in the docs sources isn't parsed (only `top|bottom|left|right of`)
- **Severity**: Low
- **Category**: dead-code (unreachable parser fallback / capability gap)
- **File**: app/_components/puml/parse.ts:382 (noteMatch regex)
- **Scenario**: The note regex only recognizes the anchored form `note (top|bottom|left|right) of <id>`. `grep -rn "note over" docs/diagrams` shows many committed sources use `note over ko, reason` / `note over gem`, and several use bare `note right: text` (no `of <id>`). Those parse as a note with no anchor edge (or, for `note over`, fail the optional-position group and fall to the bare-`note`+`:` path). This is invisible in the app today only because the 9 files using `note over` (03-14) are **not wired into the page** — `DIAGRAMS` in page.tsx renders only 01/02/15, confirmed by `grep -rn "03-domain\|...\|14-" app/` returning nothing. So the anchor-resolution code path for `over`-anchored notes is effectively unexercised/unsupported.
- **Root cause**: Parser was built against the wired subset; `note over` was never needed by 01/02/15/STEP_DETAILS.
- **Impact**: Latent — if any 03-14 diagram is ever added to `DIAGRAMS`, its `note over` annotations silently lose their anchor (no connecting edge). Documentation/capability drift, not a live bug.
- **Fix sketch**: Low priority. Either extend the regex to accept `over\s+<id>(?:,\s*<id>)*` (anchor to the first id) or add a parser comment that `over` is intentionally unsupported, so the gap is explicit rather than accidental.

## 5. Cross-file color duplication: the `C` map in PlantUml.tsx restates hexes that also live in DIAGRAM_STATUS_TOKENS
- **Severity**: Low
- **Category**: duplication
- **File**: app/_components/puml/PlantUml.tsx:22-48 (the `C` map) vs constants.ts:38-40; also the inline `<style>` at PlantUml.tsx:592 hard-codes `#d65a4a`
- **Scenario**: The file comment for `C` says it's "The single home for every diagram colour," but it isn't quite: the status fills/strokes are owned by `DIAGRAM_STATUS_TOKENS` (constants.ts), while `componentStyle` reaches into those tokens AND `C` reaches them via `C.coral = "#d65a4a"`, and the active/hover CSS at line 592 hard-codes the *literal* `#d65a4a` / `stroke:#d65a4a` twice more rather than referencing `C.coral` or the token. So coral lives as a literal in at least three spots (C.coral, DIAGRAM_STATUS_TOKENS.gate.stroke, and the inline style string).
- **Root cause**: The inline `<style>` is a template string (can't use JS constants inline without interpolation), so the active-border color was pasted as a literal; `C` predates the tokens being centralized.
- **Impact**: Low — re-toning the coral "active step" highlight means editing a raw string the "single home" comment implies you shouldn't have to. Mild contradiction of the stated single-source intent.
- **Fix sketch**: Interpolate `C.coral` into the `<style>` template (it's already a JS string literal: `\`...stroke:${C.coral}...\``), and add a one-line note that the status fill/stroke trio is owned by constants while `C` owns the primitive/shape tints — so the boundary is documented rather than blurred.

## 6. Two near-identical `role="alert"` fallback blocks in PlantUml render
- **Severity**: Low
- **Category**: duplication
- **File**: app/_components/puml/PlantUml.tsx:419-425 (tooLarge) and :430-436 (layout failed)
- **Scenario**: The "too large" and "couldn't render" branches return byte-for-byte the same wrapper — `<div role="alert" className={\`rounded-lg border border-stone-200 bg-paper p-4 text-sm text-steel ${className}\`}>` — differing only in the message string. Confirmed by reading both blocks; the className string is duplicated verbatim.
- **Root cause**: Two failure modes added at different times, each copying the wrapper.
- **Impact**: Cosmetic — two places to keep in sync if the alert styling changes. Very low value but a trivially clean dedup.
- **Fix sketch**: Extract a tiny local `DiagramNotice({ children })` (or a `noticeCls` constant) and have both branches render `<DiagramNotice>This diagram is too large…</DiagramNotice>` / `<DiagramNotice>Couldn't render…</DiagramNotice>`.
