/** Join the orbit's own class names (pipelineOrbit.css), dropping the falsy ones. The orbit's controls
 *  are painted by its stylesheet, not by Tailwind steps, so a button's class is built here and handed in
 *  whole (the style ratchet reads that as a delegated class, never a hand-rolled one). */
export function cx(...parts: (string | false | null | undefined | 0)[]): string {
  return parts.filter(Boolean).join(" ");
}
