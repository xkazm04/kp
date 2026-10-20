/** A band's torn top edge (prototype `svg.edge`): filled with the band's own
 *  --bg by land-style.css, drawn over the band above. Decorative. */
export function Edge({ d }: { d: string }) {
  return (
    <svg className="edge" viewBox="0 0 1600 60" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}
