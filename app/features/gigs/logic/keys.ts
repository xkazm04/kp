// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

/** A keystroke meant for a field, not for the desk's shortcuts. A checkbox is not a
 *  field: 1-6 must still tick with focus on one. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as { tagName?: string; type?: string; isContentEditable?: boolean };
  const tag = (el.tagName ?? "").toLowerCase();
  if (el.isContentEditable) return true;
  if (tag === "textarea" || tag === "select") return true;
  if (tag === "input") return !["checkbox", "radio", "button", "submit"].includes((el.type ?? "").toLowerCase());
  return false;
}

/** The checklist item a digit key toggles, or null. */
export function checklistKeyFor(key: string, items: readonly string[]): string | null {
  if (!/^[1-9]$/.test(key)) return null;
  return items[Number(key) - 1] ?? null;
}
