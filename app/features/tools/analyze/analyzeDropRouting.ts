// Pure routing rules for the Analyze drag-and-drop intake — kept free of React
// and the DOM so they can be unit-tested under `npm run test:unit` (idea-1a75b476).
//
// useGlobalFileDrag registers a window-level "drop a CV anywhere on the page"
// catch. But the job-description and company columns — and the empty CV zone —
// render their OWN labeled drop targets. Because native drop events bubble up to
// window, a file dropped onto one of those labeled zones fires BOTH the zone's
// onDrop AND the window catch: it lands in its own bucket (e.g. the JD) AND is
// silently added as a phantom CV variant, producing a nonsense best-of-N run the
// user never asked for. To keep a labeled-zone drop exclusive to that zone, each
// such zone carries the data attribute below, and the window catch refuses to
// claim any drop that landed inside one.

/** Marks a labeled file zone that owns its own drop (the empty CV zone, the job
 *  description zone, the company zone). The window-level CV catch skips any drop
 *  whose target sits inside an element carrying it. */
export const OWNED_DROP_ZONE_ATTR = "data-file-dropzone";

/** Spread onto a labeled zone's root element to mark it owned, so the marker and
 *  the catch that reads it stay a single source of truth. */
export const ownedDropZoneProps: { [OWNED_DROP_ZONE_ATTR]: "" } = { [OWNED_DROP_ZONE_ATTR]: "" };

/** True when `target` sits inside a labeled zone that owns its drop. Duck-types
 *  `closest` so it runs both in the browser and under the DOM-less unit runner,
 *  and tolerates non-Element targets (document, text nodes) that have no
 *  `closest`. */
export function isOwnedDropZoneTarget(target: EventTarget | null): boolean {
  const el = target as { closest?: (selectors: string) => unknown } | null;
  if (!el || typeof el.closest !== "function") return false;
  return el.closest(`[${OWNED_DROP_ZONE_ATTR}]`) != null;
}

/** The window catch's routing decision for a drop: the File to add as a CV
 *  variant, or null to leave the drop to whichever labeled zone (if any) owns it.
 *  Routes only a genuine file drag that did NOT land inside an owned zone — the
 *  one rule that stops a JD/company drop from also becoming a phantom CV. */
export function resolveWindowDropTarget(
  isFileDrag: boolean,
  target: EventTarget | null,
  file: File | null,
): File | null {
  if (!isFileDrag) return null;
  if (isOwnedDropZoneTarget(target)) return null;
  return file;
}
