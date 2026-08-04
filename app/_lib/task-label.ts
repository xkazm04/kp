// A background task's display label, as a LOCALIZABLE reference rather than a
// baked English sentence.
//
// The label is written into the `tasks.label` column by the server the moment a
// task is enqueued (app/_lib/tasks.ts), long before anyone renders it — there is
// no request locale to read there, `startTask` is synchronous (so the async
// `namespaceTranslator` is not an option), and a row outlives any one reader
// anyway: the same task is read by the sidebar dock, the tab, and the history
// pager, each of which must speak the CURRENT reader's language.
//
// So the column stores a reference — `{ k, v }`, a catalog key under
// `tasks.kind.*` plus its ICU values — and the UI resolves it at render time.
// Values keep their raw JS types (a count stays a NUMBER, so the ICU plural in
// `kind.batchOutreach` gets a number and not the string that would render the
// literal word `NaN` — see docs/architecture/localization.md).
//
// Rows written before this seam existed hold a plain English sentence; they
// decode to null and are rendered verbatim, so no migration is needed.

export type TaskLabelRef = {
  /** Catalog key under the `tasks.kind` namespace. */
  k: string;
  /** ICU values. Numbers stay numbers. */
  v?: Record<string, string | number>;
};

// A sentinel no human-written label can collide with, so "is this a reference or
// a legacy sentence?" is a prefix test rather than a guess at JSON-ness.
const PREFIX = "kp.tl:";

export function encodeTaskLabel(k: string, v?: Record<string, string | number>): string {
  return PREFIX + JSON.stringify(v && Object.keys(v).length > 0 ? { k, v } : { k });
}

export function decodeTaskLabel(label: string | null | undefined): TaskLabelRef | null {
  if (typeof label !== "string" || !label.startsWith(PREFIX)) return null;
  try {
    const parsed = JSON.parse(label.slice(PREFIX.length)) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const ref = parsed as { k?: unknown; v?: unknown };
    if (typeof ref.k !== "string" || !ref.k) return null;
    return {
      k: ref.k,
      v: ref.v && typeof ref.v === "object" ? (ref.v as Record<string, string | number>) : undefined,
    };
  } catch {
    return null;
  }
}

/** Minimal structural shape of a next-intl translator scoped to `tasks` — the
 *  same trick `labelOr` uses, so this helper works without coupling to one
 *  namespace's generated key union. Only `has` is declared: next-intl types the
 *  translator's `values` argument FROM the key, so a structural call signature
 *  over the erased key type can never match it. The call is cast at the one site
 *  below, after `has` has proved the key exists. */
type TaskTranslator = { has: (key: never) => boolean };

/** The reader-facing label for a task row. A decodable reference resolves through
 *  `tasks.kind.<k>`; anything else (a legacy English row, an unknown key) falls
 *  back to what is on the row, then to the raw kind — never to an empty cell. */
export function renderTaskLabel<T extends TaskTranslator>(
  t: T,
  task: { label: string | null; kind: string }
): string {
  const ref = decodeTaskLabel(task.label);
  if (!ref) return task.label ?? task.kind;
  const key = `kind.${ref.k}` as Parameters<T["has"]>[0];
  if (!t.has(key)) return task.kind;
  const translate = t as unknown as (k: unknown, values?: Record<string, string | number>) => string;
  return translate(key, ref.v);
}
