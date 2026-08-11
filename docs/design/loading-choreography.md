# Loading choreography

How every workspace tab is allowed to appear. One pattern, twenty tabs, so
switching between them feels like one product instead of twenty prototypes.

The short version: **chrome instantly, primary content the moment it exists,
everything heavy a beat later — and nothing that pretends to be content while we
wait.** No skeletons.

## Why we changed

Before this pattern, a cold tab switch could show, in sequence: a three-bar
generic skeleton (the chunk loading), then a *differently shaped* per-tab
skeleton (the fetch), then the real page — three layouts in under a second. Other
tabs showed a bare "Loading…" line; others showed nothing at all and then
big-banged 1500 nodes onto one frame. Same product, three unrelated experiences.

## The five laws

1. **Chrome always renders.** Page header (eyebrow, title, intro), filter bars,
   tab strips, panel frames, table column headers, section titles — these depend
   on nothing and must never sit inside a loading branch. They are the page's
   identity: the user should know where they are on the first frame.

2. **Content is never held.** The moment data exists it renders. No minimum
   placeholder duration, no "wait for everything then reveal", no cross-fading
   the placeholder out before fading the content in. Placeholder → content is a
   plain conditional swap in the same geometry.

3. **Delays live on the placeholder, never on content.** A gap-filler uses
   `.reveal-quiet` (invisible for 150ms, then a 200ms fade — pure CSS,
   `animation-fill-mode: both`). Anything that resolves inside that window paints
   no placeholder at all. This is the whole anti-flash mechanism and it costs
   zero timers.

4. **No skeletons.** We do not draw fake headings, fake rows or pulsing grey
   bars. They lie about the layout, they double the number of visual states, and
   `animate-pulse` reads as "broken" more often than "loading". A gap is either
   *nothing* (with height reserved so the page doesn't jump) or, where the region
   is genuinely empty and a fetch is genuinely in flight, one short line of real
   copy. When ripping a skeleton out, keep whatever height it was reserving.

5. **Arrive in waves, not in one big bang.** A tab commits in three tiers (below).
   Never build 1500 DOM nodes in the frame the user pressed the button.

## The three tiers

| Tier | What | When it commits | How it enters |
|---|---|---|---|
| 1 | Chrome + primary content | first frame | `stagger-children` cascade on the section wrapper |
| 2 | Data-dependent regions | the frame data arrives | `.animate-arrive-in` on the region |
| 3 | Heavy / secondary / below-the-fold | one frame or idle later, or on scroll | `<Defer>`, then its own tier-1/2 rules |

### Tier 1 — the first frame

The tab's outer wrapper carries `stagger-children` so its direct children cascade
in (40 / 90 / 140 / 190 / 240ms, capped at 280ms — defined in `app/globals.css`).
`Workspace.tsx` already plays `animate-tab-in` on the tab container; the stagger
is the second level of that same entrance.

```tsx
// SECTION = "space-y-8" from recipes.ts
<div className={`stagger-children ${SECTION}`} aria-busy={data == null}>
  <header className={PAGE_HEADER}>…</header>   {/* renders with no data */}
  <FilterBar … />                              {/* renders with no data */}
  <ResultsRegion … />                          {/* tier 2 lives in here */}
</div>
```

Rules:
- Direct children of a `stagger-children` container are what cascade — keep them
  to the handful of real sections. Don't wrap everything in one div (nothing
  staggers) and don't put 40 rows directly in it (they'd all land at 280ms).
- **Never put `.animate-arrive-in` on a direct child of `stagger-children`.** The
  cascade already animates it, and `.stagger-children > *` wins on specificity
  anyway. `.animate-arrive-in` is for regions *nested deeper* that swap on their
  own data.
- `aria-busy` goes on the container while the first load is in flight.

### Tier 2 — content arriving

A region whose content depends on a fetch renders, in the same geometry, one of:

- **data** → the real thing, wrapped in `.animate-arrive-in` (opacity-only fade;
  it settles in place rather than sliding, because the surrounding layout is
  already on screen);
- **empty + fetch in flight** → a `.reveal-quiet` element that reserves the
  region's height and says nothing, or one line of quiet copy where the wait is
  expected to be long (an LLM call). Never a skeleton;
- **empty + fetch settled** → the real empty state (`ChainEmptyState` etc.);
- **failed** → the error affordance the tab already uses.

```tsx
{rows == null ? (
  // Fetch in flight, nothing to show yet: hold the space, stay invisible for
  // 150ms so a fast response never flashes anything.
  <div className="reveal-quiet min-h-[18rem]" aria-hidden />
) : rows.length === 0 ? (
  <ChainEmptyState … />
) : (
  <div className="animate-arrive-in">
    <ResultsTable rows={rows} />
  </div>
)}
```

**A refresh must never hide data that is already on screen.** A loading flag
decides what an *empty* region shows — nothing more. Re-fetches settle silently
behind the current content.

**A form is chrome; only its VALUES are data.** Panel frames, labels, help text
and buttons are hardcoded — hold a `reveal-quiet` box for a *region*, never for a
settings form that a round-trip fills with three strings. Render the form on the
first frame and pass a `disabled` flag while the fetch is in flight, so a
keystroke typed into the gap can't be silently overwritten when the payload
lands. `Settings → Branding` (`BrandingTab` + `BrandingEditorForm`) is the
reference: it used to hold a 26rem box for a layout that needed no data to draw.

**Don't gate a `<Defer>` subtree on the parent's fetch.** A secondary panel that
owns its own data (`Settings → Models`' keys/usage panels) must mount on its own
schedule; gating it on the primary payload turns two independent requests into a
serial waterfall — parent round-trip, then chunk download, then the child's fetch.
`<Defer>` alone already keeps it off the first frame, which is the only thing such
a gate ever buys.

### Tier 3 — deferring the heavy stuff

`app/_components/ui/Defer.tsx`:

```tsx
<Defer strategy="next-frame">…</Defer>   // just below the primary content
<Defer strategy="idle">…</Defer>         // secondary panels (default)
<Defer strategy="visible">…</Defer>      // far below the fold; mounts on scroll
```

`<Defer>` is **not** a loading state — its children are ready, we are choosing
when to commit them. Pass `placeholder={<div className="min-h-[N] reveal-quiet" />}`
only when the gap would collapse the layout.

Combine with code splitting when the subtree is genuinely heavy (a chart library,
a 900-line table, a modal that most sessions never open):

```tsx
const UsagePanel = dynamic(() => import("./UsagePanel").then((m) => ({ default: m.UsagePanel })), {
  loading: () => <div className="reveal-quiet min-h-[12rem]" aria-hidden />,
});
…
<Defer strategy="idle">
  <UsagePanel />
</Defer>
```

Ordering is declared by **JSX order** inside the staggered container. There is no
priority registry.

## What to reach for

| Need | Use | Where |
|---|---|---|
| Cascade a section's children in | `className="stagger-children"` | globals.css |
| Content just arrived, fade it in place | `className="animate-arrive-in"` | globals.css |
| Hold space while waiting, invisibly | `className="reveal-quiet"` + a `min-h-*` | globals.css |
| Commit a subtree later | `<Defer strategy=…>` | `app/_components/ui/Defer.tsx` |
| Split a heavy subtree into its own chunk | `next/dynamic` + `.reveal-quiet` loading | — |
| Know if motion is off | `useReducedMotion()` | `app/_lib/useReducedMotion.ts` |

Everything CSS-based is already reduced-motion gated in `globals.css`; `<Defer>`
collapses its timed strategies under reduced motion by itself. **Do not add
`prefers-reduced-motion` handling at call sites** — if you find yourself needing
it, the primitive is missing something.

## Anti-patterns (do not ship these)

- A `<Skeleton>` block standing in for content. Delete it; reserve the height.
- `animate-pulse` on anything.
- A bare `<p>Loading…</p>` as a tab's whole first state.
- A spinner for *tab entry*. Spinners are for user-triggered actions
  (save, generate, run) — that use is fine and stays.
- Holding real content until a sibling finishes ("wait for all three fetches").
- Fading the placeholder out and the content in (double motion, forced delay).
- Hiding already-rendered rows because a refresh started.
- Framer-motion for a simple entrance. The CSS classes above do it for free; keep
  framer for interaction (shared-layout toggles, drag, gestures).
- A per-tab reinvention of any of the above.

## Accessibility

- The staggered container carries `aria-busy` during the first load.
- Placeholders are `aria-hidden` — they carry no information.
- Announce state changes with the copy that already exists (empty states, error
  banners). Never announce "loading" three times for one page.

## The worked example

`app/features/settings/models/ModelsTab.tsx` is the reference implementation — read it
before starting a tab. It shows all three tiers in ~40 lines of diff:

- the section wrapper became `stagger-children space-y-6` with `aria-busy` on the
  first load;
- two pulsing `<Skeleton>` slabs became one `reveal-quiet min-h-[26rem]` box that
  holds the routing table's height and shows nothing;
- the three panels below the table became `next/dynamic` chunks (each with a
  quiet reserved-height chunk gap) mounted through `<Defer>` — `next-frame` for
  the one just below the fold, `idle` for the two after it.

## Scope note

This document is about *when things appear*. It is not a licence to restyle a
tab, unify page headers, change data-fetching libraries, or rename props. Those
are separate jobs.
