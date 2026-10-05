import { BRAND } from "./glyphs";

/** The prototype's lockup: the coral "K" tile and the wordmark with its coral D.
 *  Goes inside an <a class="brand"> that carries the accessible name. */
export function BrandMark() {
  return (
    <>
      <span className="logo" aria-hidden="true">
        {BRAND.initial}
      </span>
      <span className="word">
        {BRAND.pre}
        <b>{BRAND.accent}</b>
        {BRAND.post}
      </span>
    </>
  );
}
