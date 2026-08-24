import type { ChatBlockLabels, ChatTableBlock } from "./chatBlockTypes";

/*
 * A table inside a chat turn.
 *
 * The premise of the whole block contract: when the answer is three or more
 * comparable things, a paragraph is the wrong shape for it. So this renders the
 * comparison as a real <table> — scannable down a column, announced as a table
 * by a screen reader — instead of a numbered list of sentences.
 *
 * It is built for a NARROW column (the companion dock is ~26rem), which decides
 * every choice here: at most four columns by contract, hairline rules instead of
 * fills, `text-sm` cells, and its own horizontal scroller so a long value
 * scrolls the table rather than the page. No sorting, no selection, no row
 * actions — it is a rendered sentence, not a data grid.
 */
export function ChatTable({ block, labels }: { block: ChatTableBlock; labels: ChatBlockLabels }) {
  const { columns, rows, title } = block;
  return (
    <figure className="animate-fade-in mt-2 w-full max-w-full">
      {title ? <figcaption className="pb-1 text-meta uppercase text-steel">{title}</figcaption> : null}
      {/* The scroller is the table's own, so a wide value never widens the dock. */}
      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white dark:rounded-2xl">
        <table className="w-full border-collapse text-left" aria-label={title ? undefined : labels.table}>
          <thead>
            <tr className="border-b border-stone-200">
              {columns.map((column) => (
                <th key={column.key} scope="col" className="whitespace-nowrap px-2.5 py-1.5 text-meta uppercase text-steel">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-b border-stone-200 last:border-b-0">
                {columns.map((column, columnIndex) => (
                  <td
                    key={column.key}
                    // The first column is the row's subject — it carries the ink
                    // weight, the rest stay quiet so the eye runs down one line.
                    className={`px-2.5 py-1.5 text-sm ${columnIndex === 0 ? "font-medium text-ink" : "text-steel nums"}`}
                  >
                    {/* An absent cell is not zero and must not read as zero. */}
                    {row[column.key] || labels.emptyCell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
