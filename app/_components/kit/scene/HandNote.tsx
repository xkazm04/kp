import type { ReactNode, Ref } from "react";
import "./scene.css";

/**
 * @catalog A note written in the margin, in the register's hand: an italic serif aside in Studio Light, a bold tilted display note in Spark Dark; `pointer` is the coral note a drawn arrow leaves from (`Wires arrow`).
 *
 * Never a new font: the hand is the register's display face (`--font-serif`). A hand note repeats
 * what a labelled region already says (put the words in the region's `aria-label`), so it is hidden
 * from assistive technology; never let one carry information found nowhere else.
 */
export function HandNote({ children, pointer = false, noteRef, className }: {
  children: ReactNode;
  pointer?: boolean;
  /** The note's element, for a `Wires` arrow to leave from. */
  noteRef?: Ref<HTMLParagraphElement>;
  className?: string;
}) {
  const cls = ["k-hand", pointer ? "k-hand--pointer" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <p ref={noteRef} className={cls} aria-hidden>
      {children}
    </p>
  );
}
