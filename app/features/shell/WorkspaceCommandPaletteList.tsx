"use client";

// The palette's result <ul> (grouped/sectioned rows + placeholders), split out of
// CommandPalette.tsx so the component stays under the 200-line file cap. Verbatim
// render logic — just relocated behind props.
import type { useTranslations } from "next-intl";
import { paletteItemId, type PaletteListView } from "./workspacePaletteResults";
import type { PaletteItem } from "./workspaceCommandPaletteTypes";

export function WorkspaceCommandPaletteList({
  items,
  active,
  listView,
  query,
  t,
  go,
  setSelected,
}: {
  items: PaletteItem[];
  active: number;
  listView: PaletteListView;
  query: string;
  t: ReturnType<typeof useTranslations>;
  go: (item: PaletteItem) => void;
  setSelected: (i: number) => void;
}) {
  return (
    <ul
      id="palette-results"
      role="listbox"
      aria-label={t("title")}
      aria-busy={listView.showSearching || undefined}
      className={`max-h-[50vh] space-y-0.5 overflow-y-auto ${listView.dimItems ? "opacity-50 transition-opacity" : ""}`}
    >
      {items.map((item, i) => {
        const prev = i > 0 ? items[i - 1] : null;
        const groupStart = !prev || prev.group !== item.group;
        // Sub-heading inside the group (the "Go to" sections). Fires on the
        // first item of the group too, so the section is always named.
        const sectionStart = !!item.section && (groupStart || prev?.section !== item.section);
        return (
          <li key={item.key}>
            {groupStart ? (
              <p className="mt-2 px-2 text-meta uppercase text-steel first:mt-0">
                {t(`groups.${item.group}` as Parameters<typeof t>[0])}
              </p>
            ) : null}
            {sectionStart ? (
              // Tight under its own group header, looser between sections.
              // (No `first:mt-0` here — a later section IS its <li>'s first
              // child, and it must keep the gap that separates sections.)
              <p className={`px-2 text-sm font-semibold text-steel/80 ${groupStart ? "mt-1" : "mt-2.5"}`}>
                {item.section}
              </p>
            ) : null}
            <button
              type="button"
              id={paletteItemId(i)}
              role="option"
              aria-selected={i === active}
              onClick={() => go(item)}
              onMouseMove={() => setSelected(i)}
              className={`focus-ring flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-base ${
                i === active ? "bg-coral/10 text-ink" : "text-ink hover:bg-paper"
              } ${item.section ? "pl-4" : ""}`}
            >
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.sub ? <span className="shrink-0 truncate text-sm text-steel">{item.sub}</span> : null}
            </button>
          </li>
        );
      })}
      {listView.placeholder === "no-results" ? (
        <li className="px-2 py-3 text-base text-steel">{t("noResults", { q: query.trim() })}</li>
      ) : null}
      {listView.placeholder === "empty" ? <li className="px-2 py-3 text-base text-steel">{t("empty")}</li> : null}
    </ul>
  );
}
