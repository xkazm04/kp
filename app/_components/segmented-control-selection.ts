// Selection resolution for SegmentedControl, kept pure (no React / framer-motion /
// path-alias imports) so the unmatched-value CONTRACT is unit-testable without a
// DOM renderer.
//
// CONTRACT — an unmatched `value` (no option's value equals it) is a DEVELOPER
// ERROR, not a supported empty state: `value` is required and is expected to be
// one of `options`. When it isn't, `hasSelection` is false, so the radiogroup
// announces nothing selected and the active ink pill is hidden — a deliberate,
// visible signal of the bug (SegmentedControl additionally warns in non-production).
// `focusIndex` still falls back to 0 so the group stays keyboard-reachable rather
// than trapping focus. A caller that genuinely needs a "nothing selected" state
// must model it as an explicit option, not an out-of-range `value`.

export type SegmentedSelection = {
  /** Index of the option whose value === value, or -1 when none matches. */
  selectedIndex: number;
  /** The group's sole tab stop: selectedIndex, or 0 when nothing matches. */
  focusIndex: number;
  /** False when `value` matched no option (the dev-error / unselected case). */
  hasSelection: boolean;
};

export function resolveSegmentedSelection<T extends string>(
  options: ReadonlyArray<{ value: T }>,
  value: T
): SegmentedSelection {
  const selectedIndex = options.findIndex((o) => o.value === value);
  return {
    selectedIndex,
    focusIndex: selectedIndex >= 0 ? selectedIndex : 0,
    hasSelection: selectedIndex >= 0,
  };
}
