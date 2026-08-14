"use client";

// A readable rendering of an arbitrary JSON value — the thing every "show me
// what this run produced" surface needs and nobody wants to hand-plumb per
// payload shape.
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
import { labelize } from "@/app/_lib/format";

/** How deep to nest before collapsing to a compact JSON tail. */
const MAX_DEPTH = 3;
/** How many entries/rows to render per collection before summarizing the rest. */
const MAX_ITEMS = 24;
/** Strings at or above this length (or containing a newline) render as prose. */
const PROSE_CHARS = 120;

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
        <span key={i} className="rounded-full bg-stone-100 px-2 py-0.5 text-sm text-steel dark:rotate-1 dark:inline-block">
          {item === null || item === undefined ? "—" : String(item)}
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
  const nested = shown.some((row) => columns.some((c) => isPlainObject(row[c]) || Array.isArray(row[c]) || isProse(row[c])));
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
          <tr className="border-b border-stone-200 text-left text-meta uppercase text-steel">
            {columns.map((c) => (
              <th key={c} className="whitespace-nowrap pb-1.5 pr-3 font-semibold">{humanizeKey(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, i) => (
            <tr key={i} className="border-b border-stone-100 last:border-0">
              {columns.map((c) => (
                <td key={c} className="py-1.5 pr-3 align-top"><Scalar value={row[c]} /></td>
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
        <h4 className="text-meta uppercase text-steel">{label}</h4>
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
          <h4 className="text-meta uppercase text-steel">{label}</h4>
          <p className="text-sm text-steel/70">{t("empty")}</p>
        </section>
      );
    }
    const objects = value.filter(isPlainObject);
    return (
      <section className="space-y-1.5">
        <h4 className="text-meta uppercase text-steel">
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
        <h4 className="text-meta uppercase text-steel">{label}</h4>
        <p className="whitespace-pre-wrap text-base leading-relaxed text-ink">{value}</p>
      </section>
    );
  }
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
      <span className="min-w-[9rem] text-meta uppercase text-steel">{label}</span>
      <span className="min-w-0 flex-1 break-words text-base"><Scalar value={value} /></span>
    </div>
  );
}

/** The recursive body: an object's entries, or a bare value at the leaf. */
function ReadoutBody({ value, depth }: { value: unknown; depth: number }) {
  const t = useTranslations("readout");
  if (depth >= MAX_DEPTH && (isPlainObject(value) || Array.isArray(value))) {
    // Past the depth cap, show the shape compactly rather than nesting forever.
    return (
      <pre className="overflow-x-auto rounded-md bg-stone-50 p-2 font-mono text-sm text-steel">
        {JSON.stringify(value, null, 1).slice(0, 600)}
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
