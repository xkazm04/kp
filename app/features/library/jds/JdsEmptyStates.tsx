"use client";

// The empty Saved-JDs ledger.
//
// The JD library is the SOURCE of the hiring chain — a job is created from a JD,
// so a library with nothing in it is the true first screen of the product. It
// reads as a shelf you stock: the centrepiece is a ghost record carrying the
// ledger's own columns, so the shape of the missing thing is legible before you
// have one, and the footer chips name what a single spec unlocks downstream.

import { LibraryEmptyShelf } from "./JdsEmptyShelf";

export function LibraryEmptyStates({
  onStartGenerate,
}: {
  /** Switch the ledger's own section toggle over to the Generate panel. */
  onStartGenerate: () => void;
}) {
  return <LibraryEmptyShelf onStartGenerate={onStartGenerate} />;
}
