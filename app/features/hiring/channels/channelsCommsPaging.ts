// Paging arithmetic for the Comms ledger — pure, so the rules that decide whether a
// recruiter is told the truth about the size of the ledger are testable without a DOM.
//
// /api/comms has answered a CURSOR contract for a while (route.ts): `hasMore` /
// `nextCursor` are about the read (more rows inside the derivation window), and
// `truncated` is about the LEDGER (older rows exist beyond the window, and no cursor
// reaches them). The table read neither, asked for the whole window in one go and
// simply ended — so "these are all the messages" and "these are the newest 500 of
// far more" looked identical.
//
// The two facts stay separate here for the same reason the route keeps them separate:
// a client that conflates them either stops early or pages forever.

import type { Message, RefInfo } from "./channelsCommsHelpers";

export type CommsPageState = {
  /** null until the first read settles — never an empty array standing in for one. */
  messages: Message[] | null;
  refs: Record<string, RefInfo>;
  /** What to hand `?cursor=` for the next (older) page, or null when there is none. */
  cursor: string | null;
  /** More rows are reachable with that cursor. */
  hasMore: boolean;
  /** Older rows exist BEYOND the derivation window. No cursor reaches them; the only
   *  honest thing to do is say so. */
  truncated: boolean;
};

export const EMPTY_COMMS_PAGE: CommsPageState = {
  messages: null,
  refs: {},
  cursor: null,
  hasMore: false,
  truncated: false,
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Fold one `/api/comms` body into the ledger's paging state.
 *
 *  Returns `null` when the body carries no `messages` array — an error body (a 401
 *  after the session lapsed, a 500) is valid JSON, and turning it into `[]` is the
 *  confident-empty bug this codebase has fixed on three other surfaces already.
 *
 *  `mode` is `"replace"` for the first read and the live refresh (both re-read the
 *  head of the ledger) and `"append"` for a "load older" page. An `append` whose
 *  response says `cursorExpired` came back from the TOP — the cursor row aged out of
 *  the window — so it replaces: appending it would duplicate the head and hide the gap. */
export function mergeCommsPage(
  state: CommsPageState,
  payload: unknown,
  mode: "replace" | "append"
): CommsPageState | null {
  const body = (payload ?? null) as Record<string, unknown> | null;
  const rows = body?.messages;
  if (!Array.isArray(rows)) return null;
  const page = rows as Message[];
  const entries = (body?.entries ?? null) as Record<string, RefInfo> | null;
  const pageRefs = entries && typeof entries === "object" ? entries : {};
  const expired = body?.cursorExpired === true;
  const appending = mode === "append" && !expired;

  let messages: Message[];
  if (!appending) {
    messages = page;
  } else {
    // Dedupe by id, keeping the row already on screen: two reads of a shifting
    // append-only ledger legitimately overlap, and a repeated row would otherwise
    // render twice under the same key.
    const seen = new Set((state.messages ?? []).map((m) => m.id));
    messages = [...(state.messages ?? []), ...page.filter((m) => !seen.has(m.id))];
  }

  const cursor = body?.hasMore === true ? str(body?.nextCursor) : null;
  return {
    messages,
    refs: appending ? { ...state.refs, ...pageRefs } : pageRefs,
    cursor,
    // No cursor is no more, whatever the flag says — that pair is how a client loops.
    hasMore: cursor !== null,
    // A truncation observed once is not un-observed by an older page that happens to
    // sit inside the window; only a fresh read of the head may clear it.
    truncated: body?.truncated === true || (appending && state.truncated),
  };
}
