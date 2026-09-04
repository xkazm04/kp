"use client";

// A readable rendering of an arbitrary JSON value — the thing every "show me
// what this run produced" surface needs and nobody wants to hand-plumb per
// payload shape.
//
// ONE CONSUMER, ON PURPOSE (re-confirmed 2026-09-03): ActivityDetailModal.
// Folding 295 lines back into that modal would trade a general renderer for a
// payload-specific one, and the next surface that shows an arbitrary result blob
// (a devcase run, an agent task) would hand-plumb its own. The cost of the extra
// file is one import; the cost of inlining it is the second copy.
//
// Built for Insights → Activity, whose row-click detail shows a background
// task's `result` blob: the shapes differ per task kind (a batch screen's
// counts, a JD build's sections, an analysis's nested scoring), they change as
// the pipeline changes, and dumping raw JSON at a recruiter is not an answer.
// So this reads the value's STRUCTURE and picks the right presentation rather
// than knowing any particular payload:
//
//   scalar                  → a definition-list row
//   long / multi-line text  → a prose block that keeps its line breaks
//   array of scalars        → a chip row
//   array of objects        → a compact table over the union of their keys
//   nested object           → a titled sub-section, indented one step
//
// Deliberately depth-capped (MAX_DEPTH) and count-capped (MAX_ITEMS): a
// multi-MB analysis payload must render as a readable summary, not freeze the
// tab. Anything past the cap is stated out loud — a silent truncation would
// read as "that's all there was", the same failure the TablePager comment
// describes.
import { useTranslations } from "next-intl";
import { CHIP_QUIET, META_LABEL } from "./recipes";
import { labelize } from "@/app/_lib/format";

/** How deep to nest before collapsing to a compact JSON tail. */
const MAX_DEPTH = 3;
/** How many entries/rows to render per collection before summarizing the rest. */
const MAX_ITEMS = 24;
/** Strings at or above this length (or containing a newline) render as prose. */
const PROSE_CHARS = 120;
/** How much of the past-the-depth-cap JSON tail to print before saying so. */
const MAX_TAIL_CHARS = 600;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Humanize an object key for display: split camelCase/PascalCase first, then run
 * the app-wide labelize (which handles snake_case, kebab-case and the acronym
 * table). labelize alone lowercases a whole camelCase token — "costPerHireUsd"
 * came out "Costperhireusd" — so the split has to happen before it, not inside
 * it, where it would change how enum VALUES render everywhere else.
 */
export function humanizeKey(key: string): string {
  return labelize(key.replace(/([a-z0-9])([A-Z])/g, "$1 $2"));
}

/** True when the value should be shown as a paragraph rather than a table cell. */
const isProse = (v: unknown): v is string =>
  typeof v === "string" && (v.length >= PROSE_CHARS || v.includes("\n"));

/**
 * Read one column out of a row WITHOUT walking the prototype chain. `columns` is
 * the union of every shown row's own keys, so a row that simply lacks a column
 * must render as absent — but a bare `row[key]` inherits Object.prototype, and a
 * payload key named `constructor` / `toString` / `valueOf` made the missing cell
 * render the native function source ("function Object() { [native code] }") in a
 * neighbouring row. Same prototype-lookup class the ACRONYMS table in
 * app/_lib/format.ts was hardened against; these keys are model-authored, so the
 * component must not trust them. Legitimate keys are unaffected — own properties
 * read exactly as before.
 */
const cellOf = (row: Record<string, unknown>, key: string): unknown =>
  Object.hasOwn(row, key) ? row[key] : undefined;

/**
 * Chip text for one array item. Objects and arrays get compact JSON rather than
 * `String(v)`: a mixed array (`[{code:"x"}, "note"]` — ordinary in an
 * LLM-authored payload) fell to the chip row and rendered the literal
 * "[object Object]", and a nested array rendered "1,2", which is
 * indistinguishable from the string "1,2".
 */
function chipText(item: unknown): string {
  if (item === null || item === undefined) return "—";
  if (typeof item !== "object") return String(item);
  try {
    return JSON.stringify(item) ?? String(item);
  } catch {
    return String(item);
  }
}

function Scalar({ value }: { value: unknown }) {
  const t = useTranslations("common");
  if (value === null || value === undefined) return <span className="text-steel/60">—</span>;
  if (typeof value === "boolean") {
    return <span className={value ? "font-medium text-moss" : "text-steel"}>{value ? t("yes") : t("no")}</span>;
  }
  if (typeof value === "number") {
    return <span className="nums text-ink">{Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>;
  }
  return <span className="text-ink">{String(value)}</span>;
}

/** A chip row for an array of scalars — reads as a set, which is what it is. */
function ChipList({ items }: { items: unknown[] }) {
  const shown = items.slice(0, MAX_ITEMS);
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((item, i) => (
        <span key={i} className={CHIP_QUIET}>
          {chipText(item)}
        </span>
      ))}
      {items.length > shown.length ? <MoreCount hidden={items.length - shown.length} /> : null}
    </div>
  );
}

/** An array of objects rendered over the union of their keys, in first-seen order. */
function ObjectTable({ rows, depth }: { rows: Record<string, unknown>[]; depth: number }) {
  const shown = rows.slice(0, MAX_ITEMS);
  const columns: string[] = [];
  for (const row of shown) for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
  // A wide row set with nested cells is not a table any more — fall back to the
  // per-item sections, which can render the nesting properly.
  const nested = shown.some((row) =>
    columns.some((c) => {
      const v = cellOf(row, c);
      return isPlainObject(v) || Array.isArray(v) || isProse(v);
    })
  );
  if (nested || columns.length === 0) {
    return (
      <div className="space-y-3">
        {shown.map((row, i) => (
          <div key={i} className="rounded-md border border-stone-200 bg-paper/40 p-3">
            <ReadoutBody value={row} depth={depth + 1} />
          </div>
        ))}
        {rows.length > shown.length ? <MoreCount hidden={rows.length - shown.length} /> : null}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className={`border-b border-stone-200 text-left ${META_LABEL}`}>
            {columns.map((c) => (
              <th key={c} scope="col" className="whitespace-nowrap pb-1.5 pr-3 font-semibold">{humanizeKey(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, i) => (
            <tr key={i} className="border-b border-stone-100 last:border-0">
              {columns.map((c) => (
                <td key={c} className="py-1.5 pr-3 align-top"><Scalar value={cellOf(row, c)} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length ? <div className="pt-2"><MoreCount hidden={rows.length - shown.length} /></div> : null}
    </div>
  );
}

/** The "and N more" line every cap in here is required to print. */
function MoreCount({ hidden }: { hidden: number }) {
  const t = useTranslations("readout");
  return <p className="text-sm text-steel">{t("more", { count: hidden })}</p>;
}

/** One key/value pair, presented by the value's shape. */
function Entry({ label, value, depth }: { label: string; value: unknown; depth: number }) {
  const t = useTranslations("readout");
  // Nested structures get a titled block; scalars stay on one line.
  if (isPlainObject(value)) {
    const empty = Object.keys(value).length === 0;
    return (
      <section className="space-y-1.5">
        <h4 className={META_LABEL}>{label}</h4>
        {empty ? (
          <p className="text-sm text-steel/70">{t("empty")}</p>
        ) : (
          <div className="border-l border-stone-200 pl-3">
            <ReadoutBody value={value} depth={depth + 1} />
          </div>
        )}
      </section>
    );
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <section className="space-y-1.5">
          <h4 className={META_LABEL}>{label}</h4>
          <p className="text-sm text-steel/70">{t("empty")}</p>
        </section>
      );
    }
    const objects = value.filter(isPlainObject);
    return (
      <section className="space-y-1.5">
        <h4 className={META_LABEL}>
          {label} <span className="font-normal normal-case text-steel/70">({value.length})</span>
        </h4>
        {objects.length === value.length ? (
          <ObjectTable rows={objects} depth={depth} />
        ) : (
          <ChipList items={value} />
        )}
      </section>
    );
  }
  if (isProse(value)) {
    return (
      <section className="space-y-1.5">
        <h4 className={META_LABEL}>{label}</h4>
        <p className="whitespace-pre-wrap text-base leading-relaxed text-ink">{value}</p>
      </section>
    );
  }
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
      <span className={`min-w-[9rem] ${META_LABEL}`}>{label}</span>
      <span className="min-w-0 flex-1 break-words text-base"><Scalar value={value} /></span>
    </div>
  );
}

/** The recursive body: an object's entries, or a bare value at the leaf. */
function ReadoutBody({ value, depth }: { value: unknown; depth: number }) {
  const t = useTranslations("readout");
  if (depth >= MAX_DEPTH && (isPlainObject(value) || Array.isArray(value))) {
    // Past the depth cap, show the shape compactly rather than nesting forever.
    // The character cap has to ANNOUNCE itself: every other cap in this file
    // prints "+N more", but this one used to cut the JSON mid-token with no mark,
    // so a deep payload read as "that's the whole tail" — exactly the silent
    // truncation the module header forbids. A trailing ellipsis is the honest
    // marker and needs no catalog key (the count here would be characters, which
    // is not a fact worth stating).
    const json = JSON.stringify(value, null, 1) ?? "";
    return (
      <pre className="overflow-x-auto rounded-md bg-stone-50 p-2 font-mono text-sm text-steel">
        {json.length > MAX_TAIL_CHARS ? `${json.slice(0, MAX_TAIL_CHARS)}\n…` : json}
      </pre>
    );
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value).slice(0, MAX_ITEMS);
    if (entries.length === 0) return <p className="text-sm text-steel/70">{t("empty")}</p>;
    // Scalars first: the at-a-glance facts shouldn't sit below a long nested
    // block the reader has to scroll past to find them.
    const scalars = entries.filter(([, v]) => !isPlainObject(v) && !Array.isArray(v) && !isProse(v));
    const blocks = entries.filter(([, v]) => isPlainObject(v) || Array.isArray(v) || isProse(v));
    const hidden = Object.keys(value).length - entries.length;
    return (
      <div className="space-y-3">
        {scalars.length > 0 ? (
          <div className="space-y-1">
            {scalars.map(([k, v]) => (
              <Entry key={k} label={humanizeKey(k)} value={v} depth={depth} />
            ))}
          </div>
        ) : null}
        {blocks.map(([k, v]) => (
          <Entry key={k} label={humanizeKey(k)} value={v} depth={depth} />
        ))}
        {hidden > 0 ? <MoreCount hidden={hidden} /> : null}
      </div>
    );
  }
  if (Array.isArray(value)) {
    const objects = value.filter(isPlainObject);
    return objects.length === value.length && value.length > 0 ? (
      <ObjectTable rows={objects} depth={depth} />
    ) : (
      <ChipList items={value} />
    );
  }
  if (isProse(value)) return <p className="whitespace-pre-wrap text-base leading-relaxed text-ink">{value}</p>;
  return <Scalar value={value} />;
}

/**
 * Render `value` — any JSON — as readable structure. `emptyLabel` is what to say
 * when there is nothing to show, so the caller words it in its own context
 * ("this run produced no output" reads better than a generic dash).
 */
export function StructuredReadout({ value, emptyLabel }: { value: unknown; emptyLabel?: string }) {
  const t = useTranslations("readout");
  const isEmpty =
    value === null ||
    value === undefined ||
    (isPlainObject(value) && Object.keys(value).length === 0) ||
    (Array.isArray(value) && value.length === 0);
  if (isEmpty) return <p className="text-base text-steel">{emptyLabel ?? t("empty")}</p>;
  return <ReadoutBody value={value} depth={0} />;
}
