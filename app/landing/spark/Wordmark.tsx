import KandidateMark from "../_components/KandidateMark";
import { DISPLAY } from "./tokens";

/*
 * The KandiDate wordmark — mark + name, with the coral "D" that gives the
 * brand its wink.
 *
 * It was hand-inlined in four places (the landing topbar and footer, /about,
 * /market), each repeating the same nested-span trick to colour one letter.
 * That is also why it showed up eight times in the untranslated-string scan:
 * the split `Kandi` / `D` / `ate` reads as three literal text nodes. A brand
 * name must NOT be translated, so the fix is not a message key — it is having
 * exactly one component that owns the spelling, which the i18n lint can then
 * be pointed at once.
 *
 * `size="sm"` is the footer lockup (smaller mark, ink-coloured); the default is
 * the topbar.
 */
// The one place the product name is spelled. Held as data, not JSX text: a
// brand name must never reach the message catalog, and keeping it out of a text
// node is what lets the i18n lint run clean over this whole directory.
const BRAND = { pre: "Kandi", accent: "D", post: "ate" } as const;

export default function Wordmark({ size = "md" }: { size?: "sm" | "md" }) {
  const small = size === "sm";
  return (
    <span className={`flex items-center ${small ? "gap-2" : "gap-3"}`}>
      <KandidateMark
        className={
          small
            ? "h-7 w-7 text-[#17202a] [--k-fg:#fdf8ee]"
            : "h-10 w-10 text-[#d65a4a] [--k-fg:#fdf8ee] [--k-accent:#17202a]"
        }
      />
      <span className={`${DISPLAY} font-bold ${small ? "text-base" : "text-2xl"}`}>
        {BRAND.pre}
        <span className="text-[#d65a4a]">{BRAND.accent}</span>
        {BRAND.post}
      </span>
    </span>
  );
}
