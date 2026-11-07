// Greet's one layout rule that is not in the core: WHERE a view sits in the conversation.
//
// The core keeps the region as one list (≤ 3 views, pins, undo). Greet draws that same
// list inside the conversation — a view sits under the reply that brought it — so it has
// to remember which turn each view arrived on. Pure and import-free, so node:test reads it.
//
//   - a view id first seen while the conversation's newest reply is turn T belongs to T
//     (a reply's own views, and a view the user's hand opened after it, read in order);
//   - a view seen before any reply belongs to the greeting (the "Show me" press);
//   - an owner is never forgotten: Undo brings back the exact ids it removed, so they
//     land back under the reply they came from, not at the bottom;
//   - a PINNED view leaves the conversation for the side ("kept beside you") and returns
//     to its reply when unpinned.

export const GREETING_OWNER = "greeting";

export type Owners = Readonly<Record<string, string>>;

/** Owners after the region changed: every id not yet placed goes to `newestTurnId`. */
export function place(owners: Owners, panelIds: readonly string[], newestTurnId: string | null): Owners {
  const fresh = panelIds.filter((id) => !(id in owners));
  if (fresh.length === 0) return owners;
  const next: Record<string, string> = { ...owners };
  for (const id of fresh) next[id] = newestTurnId ?? GREETING_OWNER;
  return next;
}

export type Placed<P> = {
  /** Unpinned views by owner (turn id or GREETING_OWNER), in region order. */
  byOwner: Record<string, P[]>;
  /** Pinned views, in region order — drawn on the side. */
  pinned: P[];
};

/** Split the region for drawing. A view with no owner yet (the render before `place`
 *  ran) goes to `fallbackOwner` so it is never dropped from the screen. */
export function arrange<P extends { id: string; pinned: boolean }>(panels: readonly P[], owners: Owners, fallbackOwner: string): Placed<P> {
  const byOwner: Record<string, P[]> = {};
  const pinned: P[] = [];
  for (const p of panels) {
    if (p.pinned) {
      pinned.push(p);
      continue;
    }
    const owner = owners[p.id] ?? fallbackOwner;
    (byOwner[owner] ??= []).push(p);
  }
  return { byOwner, pinned };
}
