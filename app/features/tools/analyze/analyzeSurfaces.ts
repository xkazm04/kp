// Surface classes shared by the Analyze intake zones that no shared recipe covers.
//
// DROP_ZONE_FOCUS exists because these zones are LABELS wrapping an `sr-only`
// file input: the ring belongs on the clipped input, so `focus-ring` on the input
// paints nothing a keyboard user can see, and the primary CV zone had no visible
// focus at all. `focus-within` moves the ring onto the visible label — the same
// technique (and the same coral ring, expressed through the paper/coral tokens so
// it re-skins in Spark Dark) that app/_components/FileInput.tsx already uses.
export const DROP_ZONE_FOCUS =
  "focus-within:outline-none focus-within:[box-shadow:0_0_0_2px_var(--color-paper),0_0_0_4px_var(--color-coral)]";
