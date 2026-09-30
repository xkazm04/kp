"use client";

import { useMemo, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit/Button";
import { Menu, type MenuOption } from "@/app/_components/kit/Menu";
import { isGigArena, type Gig } from "@/app/_lib/gigs/types";
import { EMPTY_FILE, type FileFilter, type FileStatus } from "../logic/file";
import type { FacetOption, FileFacets } from "../logic/fileFacets";
import type { SourceRow } from "../logic/wire";
import { useGigsFormat } from "../data/useGigsFormat";

// The whole file's filter row (GigsFile.tsx): Status, Arena and Type as kit Menus, then Clear
// and the `/` search. Each option carries its count in its name, counted over the gigs the
// OTHER filters and the search let through (logic/fileFacets.ts); an option holding nothing
// under the combination is disabled and last. An arena whose wires never ran reads its reason
// instead of a count, and picking it opens the Wires page: never a measured 0.

const ALL_LANES = "all";
const TO_WIRES = "wires:";

export function FileFilters({
  gigs,
  sources,
  facets,
  filter,
  set,
  statusLabel,
  laneName,
  searchRef,
  onToWires,
}: {
  gigs: readonly Gig[];
  sources: readonly SourceRow[];
  facets: FileFacets;
  filter: FileFilter;
  set: (patch: Partial<FileFilter>) => void;
  statusLabel: (s: FileStatus) => string;
  laneName: (lane: string) => string;
  searchRef: RefObject<HTMLInputElement | null>;
  onToWires: () => void;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const named = <V,>(o: FacetOption<V>, name: string): MenuOption => ({ value: String(o.value ?? ALL_LANES), label: `${name} · ${fmt.number(o.count)}`, disabled: o.off });

  const neverRun = useMemo(() => {
    const out = new Set<string>();
    for (const a of new Set(sources.map((s) => s.arena))) {
      const src = sources.filter((s) => s.arena === a);
      if (!gigs.some((g) => g.arena === a) && src.every((s) => s.lastRunAt === null)) out.add(a);
    }
    return out;
  }, [gigs, sources]);

  const status = facets.status.map((o) => named(o, statusLabel(o.value)));
  const arena = [
    ...facets.arena.filter((o) => !neverRun.has(o.value)).map((o) => named(o, o.value === "all" ? t("file.all") : fmt.arena(o.value))),
    ...[...neverRun].map((a) => ({ value: `${TO_WIRES}${a}`, label: t("file.neverRun", { arena: fmt.arena(a) }) })),
  ];
  const lane = facets.lane.map((o) => named(o, o.value === null ? t("file.all") : laneName(o.value)));
  const dirty = filter.status !== EMPTY_FILE.status || filter.arena !== "all" || filter.lane !== null || filter.search !== "";

  return (
    <div className="k-kit file-bar" role="group" aria-label={t("file.filters")}>
      <Menu label={t("file.statusLabel")} options={status} selected={[filter.status]} onSelect={(v) => set({ status: v as FileStatus })} />
      <Menu
        label={t("file.arenaLabel")}
        options={arena}
        selected={[filter.arena]}
        onSelect={(v) => (v.startsWith(TO_WIRES) ? onToWires() : set({ arena: v === "all" || isGigArena(v) ? v : "all" }))}
      />
      <Menu
        label={t("file.laneLabel")}
        options={lane}
        selected={[filter.lane ?? ALL_LANES]}
        onSelect={(v) => set({ lane: v === ALL_LANES ? null : v })}
      />
      {dirty ? <Button label={t("file.clear")} variant="ghost" size="sm" onClick={() => set({ status: EMPTY_FILE.status, arena: "all", lane: null, search: "" })} /> : null}
      <label className="search">
        <span className="sr-only">{t("file.search")}</span>
        <input
          ref={searchRef}
          type="search"
          value={filter.search}
          placeholder={t("file.search")}
          autoComplete="off"
          aria-keyshortcuts="/"
          onChange={(e) => set({ search: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Escape") e.currentTarget.blur();
          }}
        />
        <kbd aria-hidden>/</kbd>
      </label>
    </div>
  );
}
