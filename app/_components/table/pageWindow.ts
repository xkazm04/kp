// The pager's arithmetic, apart from its component.
//
// Seven surfaces call `clampPage` + `pageSlice` (the Channels ledger, both
// receiver tables, the Activity ledger, the Archetypes roster, the Assignments
// outbox, the Tasks window) and it is what makes "a filter shrank the table
// under a reader who is on page 3" safe without an effect that resets the page:
// the clamp is DERIVED state, so it cannot get out of step with the data the
// way a `useEffect(() => setPage(0))` race can.
//
// It lives in its own `.ts` module because that contract is worth testing and
// `TablePager.tsx` cannot be imported by the unit runner (JSX is not stripped).
// Three pure functions with no React in them had no business being reachable
// only through a component. `TablePager.tsx` re-exports all four names, so every
// existing import keeps working — see `table-pager.test.ts` for the cases.

/** Rows per page, shared by every table so paging feels identical across surfaces. */
export const TABLE_PAGE_SIZE = 20;

/** Total pages for `total` rows — at least 1, so an empty table is "page 1 of 1". */
export function pageCount(total: number, pageSize = TABLE_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** The page index actually safe to render. Filters shrink the result set under a
 *  reader who is on page 3, so every caller clamps rather than resetting from an
 *  effect — the clamp is derived state and cannot get out of step with the data. */
export function clampPage(page: number, total: number, pageSize = TABLE_PAGE_SIZE): number {
  return Math.min(Math.max(0, page), pageCount(total, pageSize) - 1);
}

/** The `shown` slice for a clamped page — the other half of the arithmetic every
 *  caller was repeating inline beside clampPage. */
export function pageSlice<T>(rows: readonly T[], page: number, pageSize = TABLE_PAGE_SIZE): T[] {
  return rows.slice(page * pageSize, (page + 1) * pageSize);
}
