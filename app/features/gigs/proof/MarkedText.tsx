import { paragraphSpans, type MarginNote } from "../logic/galley";

/** A paragraph with its noted phrases underlined; each note's letter rides the run where
 *  the note ends. */
export function MarkedText({ text, notes }: { text: string; notes: readonly MarginNote[] }) {
  const spans = paragraphSpans(text, notes);
  const ends = spans.map((_, j) => spans.slice(0, j + 1).reduce((n, x) => n + x.text.length, 0));
  return (
    <>
      {spans.map((s, j) => {
        if (!s.mark) return <span key={j}>{s.text}</span>;
        const ending = s.mark.filter((m) => m.end === ends[j]);
        return (
          <span key={j}>
            <mark className={`pm${s.mark.every((m) => m.source === "lint") ? " lint" : ""}`}>{s.text}</mark>
            {ending.map((m) => (
              <sup key={m.key} className="pk">
                {m.key}
              </sup>
            ))}
          </span>
        );
      })}
    </>
  );
}
