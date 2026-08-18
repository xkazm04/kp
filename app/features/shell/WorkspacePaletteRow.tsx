"use client";

// One palette result row, shared by the Spotlight and Ledger variants: a tinted
// glyph tile for the entity kind, the label with the query match highlighted, and
// the item's `sub` rendered as REAL data — an analysis score becomes a ScoreBadge,
// a profile archetype a quiet chip, a pipeline "job · stage" stays a meta line —
// instead of a uniform grey caption. `role="option"` + the stable paletteItemId
// keep aria-activedescendant / scroll-into-view working from the host.
import { CornerDownLeft } from "lucide-react";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { CHIP_QUIET } from "@/app/_components/ui/recipes";
import { paletteItemId } from "./workspacePaletteResults";
import { groupMeta } from "./workspacePaletteMeta";
import type { PaletteItem } from "./workspaceCommandPaletteTypes";

/** Split `text` around the first case-insensitive occurrence of `q` so the match
 *  can be emphasised. Returns [before, match, after]; match is "" when absent. */
export function splitMatch(text: string, q: string): [string, string, string] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [text, "", ""];
  const at = text.toLowerCase().indexOf(needle);
  if (at < 0) return [text, "", ""];
  return [text.slice(0, at), text.slice(at, at + needle.length), text.slice(at + needle.length)];
}

export function Highlight({ text, q }: { text: string; q: string }) {
  const [before, match, after] = splitMatch(text, q);
  if (!match) return <>{text}</>;
  return (
    <>
      {before}
      <mark className="rounded-sm bg-limewash px-0.5 text-ink">{match}</mark>
      {after}
    </>
  );
}

/** The item's secondary fact, drawn as the data it is. */
export function PaletteMeta({ item }: { item: PaletteItem }) {
  if (!item.sub) return null;
  if (item.group === "analysis") {
    const score = Number(item.sub);
    return Number.isFinite(score) ? <ScoreBadge score={score} /> : <span className="text-sm text-steel">{item.sub}</span>;
  }
  if (item.group === "profile") return <span className={CHIP_QUIET}>{item.sub}</span>;
  return <span className="truncate text-sm text-steel">{item.sub}</span>;
}

export function PaletteRow({
  item,
  index,
  isActive,
  query,
  go,
  setSelected,
  dense = false,
  trailing,
}: {
  item: PaletteItem;
  index: number;
  isActive: boolean;
  query: string;
  go: (item: PaletteItem) => void;
  setSelected: (i: number) => void;
  /** Ledger mode: tighter row, no enter-hint (the preview pane carries the affordance). */
  dense?: boolean;
  /** Right-edge slot (a group eyebrow, a section name). */
  trailing?: React.ReactNode;
}) {
  const { icon: Icon, tint } = groupMeta(item.group);
  return (
    <button
      type="button"
      id={paletteItemId(index)}
      role="option"
      aria-selected={isActive}
      onClick={() => go(item)}
      onMouseMove={() => setSelected(index)}
      className={`focus-ring group flex w-full items-center gap-3 rounded-lg text-left transition-colors ${dense ? "px-2 py-1.5" : "px-3 py-2"} ${
        isActive ? "bg-coral/10 text-ink dark:border dark:border-coral/30" : "text-ink hover:bg-stone-50"
      }`}
    >
      <span className={`flex shrink-0 items-center justify-center rounded-md ${dense ? "h-7 w-7" : "h-8 w-8"} ${tint} dark:-rotate-2`} aria-hidden>
        <Icon size={dense ? 14 : 16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate ${dense ? "text-sm" : "text-base"} font-medium`}>
          <Highlight text={item.label} q={query} />
        </span>
        {!dense && item.sub ? (
          <span className="mt-0.5 flex items-center gap-2">
            <PaletteMeta item={item} />
          </span>
        ) : null}
      </span>
      {trailing}
      {!dense ? (
        <span className={`shrink-0 text-steel transition-opacity ${isActive ? "opacity-100" : "opacity-0"}`} aria-hidden>
          <CornerDownLeft size={14} />
        </span>
      ) : null}
    </button>
  );
}
