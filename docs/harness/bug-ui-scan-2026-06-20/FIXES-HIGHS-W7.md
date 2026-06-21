# High Fix Wave 7 — shared dialog a11y (Modal/drawer focus management)

> The 5 "hand-rolled dialogs bypass the shared Modal" finding, resolved by **extracting
> Modal's a11y machinery into a shared `useDialogA11y` hook** (one implementation, one
> stack) and migrating the real drawers onto it — instead of forcing centered-Modal layout
> onto side panels. 2 commits. Baseline preserved: tsc **0**, `next build` ✓, unit **1019/1019**.

## Commits

| Commit | What |
|---|---|
| `a48e9d7` | New `app/_components/useDialogA11y.ts`: focus-trap, ref-counted scroll-lock, document-level Escape gated to the top of ONE shared mount-order stack, and focus restore — parameterized by `trap`/`lockScroll`. `Modal` now uses it (trap+lock) and re-exports `isAnyModalOpen`. Faithful extraction → Modal behavior unchanged. |
| `7adfc90` | `CandidateDrawer` (a real modal drawer: `aria-modal` + dimming backdrop) replaced its hand-rolled, **node-bound** trap with the hook (trap+lock) — fixing the Escape-only-when-focus-inside gap and joining the shared stack. `PipelineExplorer`'s step drawer is **deliberately non-modal** (the funnel stays clickable) — it gets focus-in + restore + Escape with `trap`/`lockScroll` **off**. |

## Why a hook, not "migrate everything to `<Modal>`"
`Modal` is **centered**; CandidateDrawer/PipelineExplorer are **side drawers** and
PipelineExplorer is **non-modal by design** (you must be able to click the funnel beside
it). Forcing the centered modal layout would have been a visual rewrite and would have
*wrongly* trapped focus on the non-modal panel. The hook gives every surface the correct
a11y for its modality while sharing one stack — which is the actual requirement (a dialog
opened over a drawer must gate Escape/Tab correctly, and `isAnyModalOpen` must see both).

## Deferred with reasons (not regressions)
- **SimExplainDrawer** — already made an honest non-modal `<aside>` in W6. It plays *alongside*
  the marketing auto-run, so moving focus into it would interrupt the walkthrough; left as-is.
- **MatrixTab reasoning popover** — a transient, cell-anchored tooltip that already has Escape +
  outside-click catcher + close button + `role="dialog"` + `aria-label`. A full focus-trap needs
  extracting it into its own component (it deeply uses local reasoning state) — disproportionate
  for a tooltip; deferred.
- **FeaturePreviews** (landing) — `aria-modal` is conditional on `pinned` (hover-preview vs
  pinned-open), which fights an unconditionally-activating hook; low-stakes marketing surface.

## Pattern catalogue additions
31. **Share the dialog *stack*, not just the styling.** Two dialog implementations with
    separate stacks both believe they're "top" — Escape/Tab fire for the wrong one. Extract
    the stack + key handling into one module both use.
32. **Match focus behavior to modality.** A non-modal panel (page stays interactive) must get
    focus-in + restore but must NOT trap Tab or lock scroll; only a true modal does both.
33. **Bind the dialog key handler to `document`, not the node.** A node-bound listener only
    fires while focus is inside, so Escape silently dies when focus sits on the container/`<body>`.
