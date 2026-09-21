// Inserting a placeholder where the author is actually typing.
//
// Pure on purpose: "click a chip, get the token at the caret" is the one bit of
// editor behaviour that is easy to get subtly wrong (appending to the end,
// losing the selection, leaving the caret before the inserted text), and a pure
// splice is the half that can be reasoned about without a DOM.

export type CaretInsert = { next: string; caret: number };

/** Splice `token` into `body` over the [start, end) selection. The returned
 *  caret sits AFTER the inserted token, so a second chip click lands beside the
 *  first rather than inside it. Out-of-range or missing bounds append. */
export function insertToken(body: string, token: string, start?: number | null, end?: number | null): CaretInsert {
  const len = body.length;
  const from = typeof start === "number" && start >= 0 && start <= len ? start : len;
  const to = typeof end === "number" && end >= from && end <= len ? end : from;
  return { next: `${body.slice(0, from)}${token}${body.slice(to)}`, caret: from + token.length };
}

/** The DOM half: splice into the live textarea, hand the new value to the
 *  caller's state setter, and restore focus + caret on the next frame (React
 *  has re-rendered the value by then, which would otherwise drop the caret to
 *  the end of the field). */
export function insertTokenInto(
  el: HTMLTextAreaElement | null,
  body: string,
  token: string,
  commit: (next: string) => void
): void {
  const { next, caret } = insertToken(body, token, el?.selectionStart, el?.selectionEnd);
  commit(next);
  if (!el) return;
  window.requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(caret, caret);
  });
}
