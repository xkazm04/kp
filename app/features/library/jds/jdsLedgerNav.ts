// Pure interaction helpers for the saved-JD ledger, kept side-effect-free so the
// two behaviours the scan flagged are unit-testable in isolation from the .tsx:
//   #2 — a manual sub-tab switch must NOT remount the JD builder (its typed draft
//        lives in the builder's local state), while a Duplicate MUST remount it so
//        it re-reads the new prefill at mount.
//   #4 — the column-header filter menu's roving-focus arrow-key navigation.
// bug-ui-scan-2026-07-09 (jd-authoring-library-templates #2, #4)

export type LedgerTab = "saved" | "generate";

// `builderKey` is the React `key` of the Generate panel. Both panels stay mounted
// (the ledger toggles visibility, it no longer unmounts one), so the ONLY thing
// that forces a builder remount is a change to this key.
export type LedgerNavState = { tab: LedgerTab; builderKey: number };

// A manual sub-tab switch: change the visible tab but keep the SAME builderKey, so
// the builder is not remounted and a half-typed JD draft survives the swap.
// bug-ui-scan-2026-07-09 (jd-authoring-library-templates #2)
export function switchTab(state: LedgerNavState, tab: LedgerTab): LedgerNavState {
  return { tab, builderKey: state.builderKey };
}

// Duplicate → Generate: advance builderKey so the builder remounts and re-reads the
// freshly-set prefill (its seeds are read at mount only).
// bug-ui-scan-2026-07-09 (jd-authoring-library-templates #2)
export function duplicateToBuilder(state: LedgerNavState): LedgerNavState {
  return { tab: "generate", builderKey: state.builderKey + 1 };
}

// Roving-focus target for the column-header filter menu: given the index of the
// currently-focused option, a keydown key, and the option count, return the index
// to move focus to — or null when the key isn't a navigation key. Wraps at both
// ends so ArrowDown past the last option lands on the first (menu convention).
// bug-ui-scan-2026-07-09 (jd-authoring-library-templates #4)
export function nextMenuIndex(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  const cur = current < 0 || current >= count ? 0 : current;
  switch (key) {
    case "ArrowDown":
      return (cur + 1) % count;
    case "ArrowUp":
      return (cur - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
