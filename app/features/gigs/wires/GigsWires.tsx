"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { GIG_INVALID_STREAK_LIMIT, type Gig, type GigStatus } from "@/app/_lib/gigs/types";
import type { CatalogEntry, SourceRow } from "../logic/wire";
import { useGigsFormat } from "../data/useGigsFormat";
import { AddWire } from "./AddWire";
import { WireRow } from "./WireRow";
import { adapterLabel } from "./wireConfig";

// Wires: the sources (B/3 "The Proof", renderWires - the owner kept it as B/3 set it).
// Official APIs only. One row per configured source: its tier mark, its name and variant,
// arena, last run, what it filed, its rejected streak as five pips (the fifth rejection in
// a row pauses it), and the two moves a row owns - scan it on its own, pause or resume it.
// The row folds open onto everything the old source card said: the terms (and, for a
// tier-B source, the acknowledgement that enables it), the keyless behaviour, the key
// NAMES it reads (never their values), its config, what it filed by status. The tier key
// is stated once above the rows, not on every card.
//
// A source's scan is POST /api/gigs/scan {sourceId}, followed through the workspace's task
// poll (useTaskResult) to its outcome and new-listing count; the line that follows it sits
// under the row, visible whether the row is open or not. Every write re-reads what it moved.
//
// Files: this page (the head, the key row, the rows); WireRow.tsx (one row) and its fold
// WireDetail.tsx; useSourceScan.ts (a source's own scan); AddWire.tsx (the add popover);
// wireConfig.ts (adapter names and config, read off a source).

export function GigsWires({
  sources,
  catalog,
  gigs,
  onChanged,
  onScanned,
}: {
  sources: readonly SourceRow[];
  catalog: readonly CatalogEntry[];
  gigs: readonly Gig[];
  /** After a pause / resume / acknowledge / add: re-read the sources. */
  onChanged: () => Promise<unknown>;
  /** A source's own scan ended: re-read the sources and the gigs. */
  onScanned: () => Promise<unknown>;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const popId = useId();
  const byAdapter = useMemo(() => new Map(catalog.map((c) => [c.adapter, c])), [catalog]);
  const addable = catalog.filter((c) => c.creatable && c.tier !== "C");

  // "Now" for the relative last-run times, refreshed each minute (not each render).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const filedBy = useMemo(() => {
    const m = new Map<string, Partial<Record<GigStatus, number>>>();
    for (const g of gigs) {
      if (!g.sourceId) continue;
      const row = m.get(g.sourceId) ?? {};
      row[g.status] = (row[g.status] ?? 0) + 1;
      m.set(g.sourceId, row);
    }
    return m;
  }, [gigs]);
  const filedTotal = (id: string) => Object.values(filedBy.get(id) ?? {}).reduce((n, v) => n + (v ?? 0), 0);
  const filed = sources.reduce((n, s) => n + filedTotal(s.id), 0);
  const forwarded = gigs.filter((g) => !g.sourceId).length;
  const ran = sources.filter((s) => s.lastRunAt).length;
  const never = sources.filter((s) => !s.lastRunAt).map((s) => adapterLabel(t, byAdapter.get(s.adapter) ?? null, s.adapter));
  const adapterCount = new Map<string, number>();
  for (const s of sources) adapterCount.set(s.adapter, (adapterCount.get(s.adapter) ?? 0) + 1);

  const deck = [
    t("wires.ran", { count: ran }),
    never.length ? t("wires.neverRan", { count: never.length, names: never.join(", ") }) : null,
    forwarded ? t("wires.forwarded", { count: forwarded }) : null,
    t("wires.pauseRule", { limit: GIG_INVALID_STREAK_LIMIT }),
  ].filter((x): x is string => x !== null);

  const addButton = (
    <button type="button" className="btn quiet wkey-add" popoverTarget={popId}>
      {t("wires.add")}
    </button>
  );

  return (
    <div className="enter">
      <header className="page-head">
        <span className="caps dim">{t("wires.title")}</span>
        <h2 className="t-display">{t("wires.headline", { wires: sources.length, filed })}</h2>
        {sources.length > 0 ? (
          <p className="deck">
            {deck.map((d, i) => (
              <span key={i}>
                {i > 0 ? <span className="sep">·</span> : null}
                {d}
              </span>
            ))}
          </p>
        ) : null}
      </header>

      <div className="wkey">
        <span>
          <span className="tier A" aria-hidden>
            A
          </span>
          {t("wires.keyA")}
        </span>
        <span>
          <span className="tier B" aria-hidden>
            B
          </span>
          {t("wires.keyB")}
        </span>
        <span>
          <span className="pips" aria-hidden>
            {Array.from({ length: GIG_INVALID_STREAK_LIMIT }, (_, i) => (
              <i key={i} className={i === 0 ? "on" : undefined} />
            ))}
          </span>
          {t("wires.keyStreak", { limit: GIG_INVALID_STREAK_LIMIT })}
        </span>
        {addButton}
      </div>

      {sources.length === 0 ? (
        <p className="q-empty">{t("wires.empty")}</p>
      ) : (
        <div className="wires">
          <div className="wires-in">
            <div className="wcols">
              <span>{t("wires.col.tier")}</span>
              <span>{t("wires.col.wire")}</span>
              <span>{t("wires.col.arena")}</span>
              <span>{t("sources.lastRun")}</span>
              <span className="r">{t("wires.col.filed")}</span>
              <span>{t("wires.col.streak")}</span>
              <span className="sr-only">{t("wires.col.actions")}</span>
              <span aria-hidden />
            </div>
            {sources.map((s) => (
              <WireRow
                key={s.id}
                source={s}
                entry={byAdapter.get(s.adapter) ?? null}
                filed={filedBy.get(s.id) ?? {}}
                shared={(adapterCount.get(s.adapter) ?? 0) > 1}
                now={now}
                onChanged={onChanged}
                onScanned={onScanned}
              />
            ))}
          </div>
        </div>
      )}

      <AddWire id={popId} entries={addable} sources={sources} onChanged={onChanged} fmtArena={fmt.arena} />
    </div>
  );
}
