// Pure render decisions for the command palette, extracted from CommandPalette.tsx so
// the node --test runner (which strips .ts types but cannot load a .tsx) can cover them.
// bug-ui-scan 2026-07-09 (app-shell-navigation #3, #4).

/**
 * #3: the stable DOM id / aria-activedescendant target for the i-th palette option.
 * One source of truth so the rendered option `id`, the input's `aria-activedescendant`,
 * and the scroll-into-view lookup can never drift apart.
 */
export function paletteItemId(index: number): string {
  return `palette-item-${index}`;
}

/**
 * #4: what the results region should render given the in-flight / query / results state.
 * While a newer debounced search is in flight we must NOT present the prior query's hits
 * as final — the pre-fix palette left the previous term's matches sitting there through
 * the debounce + round-trip with no pending affordance, then snapped silently. So:
 *   - show a "Searching…" affordance whenever a >= 2-char query is loading, and
 *   - dim any lingering rows so stale matches don't masquerade as final results, and
 *   - never flash the "no matches" placeholder for a term still being fetched.
 */
export type PaletteListView = {
  /** render the "Searching…" affordance (a newer query is being fetched) */
  showSearching: boolean;
  /** items are present but a newer search is in flight — de-emphasize them */
  dimItems: boolean;
  /** bottom placeholder when there are no items and nothing is loading */
  placeholder: "no-results" | "empty" | null;
};

export function paletteListView(args: {
  loading: boolean;
  /** trimmed query length */
  queryLen: number;
  itemCount: number;
  hasError: boolean;
}): PaletteListView {
  const { loading, queryLen, itemCount, hasError } = args;
  // A search only runs at >= 2 chars (the fetch guard), so "searching" is scoped to
  // that — an empty / 1-char box is at rest, not loading.
  const searching = loading && queryLen >= 2;
  if (itemCount > 0) {
    return { showSearching: searching, dimItems: searching, placeholder: null };
  }
  if (searching) {
    return { showSearching: true, dimItems: false, placeholder: null };
  }
  // No items, nothing loading: distinguish "searched, nothing matched" from "at rest"
  // — and never call it "no matches" while an error is already shown.
  if (queryLen >= 2 && !hasError) {
    return { showSearching: false, dimItems: false, placeholder: "no-results" };
  }
  return { showSearching: false, dimItems: false, placeholder: "empty" };
}
