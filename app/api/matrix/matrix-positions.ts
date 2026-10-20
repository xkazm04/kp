// The position-building step of GET /api/matrix, kept pure so it can be tested
// without the Python scorer. The default columns are the pipeline's positions
// (listOpenPositions); a `?job=` role that has no pipeline entry yet is appended
// here so "Rank in matrix" on a freshly posted role scores a column instead of
// reading as a closed one.
export type MatrixPosition = { id: string; title: string; roleFamily: string | null };
export type ScopedRole = { id: string; title: string; roleFamily: string | null; status: string };

/** Only a role that can still be hired for is ranked on request. A filled or closed
 *  role stays out (the tab says so), as does one the workspace cannot see (null). */
export const SCOPABLE_ROLE_STATUSES: readonly string[] = ["open", "draft"];

export function withScopedPosition(positions: MatrixPosition[], scoped: ScopedRole | null): MatrixPosition[] {
  if (!scoped || !SCOPABLE_ROLE_STATUSES.includes(scoped.status)) return positions;
  if (positions.some((p) => p.id === scoped.id)) return positions;
  const added: MatrixPosition = { id: scoped.id, title: scoped.title, roleFamily: scoped.roleFamily };
  // Columns are presented alphabetically by title, as listOpenPositions does.
  return [...positions, added].sort((a, b) => a.title.localeCompare(b.title));
}
