"use client";

import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { CohortDimension, CohortView } from "../../cohortTypes";
import { BUS_ORDER, busLeader, masterClaim, noiseGroup, patchOrder, type PatchOrder } from "./consoleModel";
import { DESK_ROWS, moveDesk, type DeskPos } from "./consoleNav";
import { ConsoleFader, ConsoleMeter, type DeskPress } from "./ConsoleCells";
import { ConsoleBusHead, ConsoleScribble } from "./ConsoleHeads";
import { ConsoleLegend, ConsoleMaster, ConsoleTalkback, ConsoleTop } from "./ConsoleMaster";
import type { Hot } from "./ConsoleReadout";
import { useStripFlip } from "./useStripFlip";
import type { ConsoleWords } from "./useConsoleWords";

/**
 * Level 0, the desk: one channel strip per member (scribble strip, six meters, the fit fader), one
 * bus per dimension across them, the master section and the talkback. One roving tab stop walks the
 * desk as a grid (arrows, Home / End); Enter on a meter, a fader or a SOLO key solos that bus,
 * on a scribble strip it opens the full report. `solo` is the bus being soloed (its descent is
 * running or open): every other bus mutes, its meters falling dark top first.
 */
export function ConsoleDesk({ view, words, order, onOrder, solo, onSolo, onOpenReport }: {
  view: CohortView;
  words: ConsoleWords;
  order: PatchOrder;
  onOrder: (o: PatchOrder) => void;
  solo: CohortDimension | null;
  onSolo: (dim: CohortDimension, focus: string | null, el: HTMLElement) => void;
  onOpenReport: (slug: string) => void;
}) {
  const strips = useMemo(() => patchOrder(view.members, order), [view.members, order]);
  const noise = useMemo(() => noiseGroup(view), [view]);
  const covered = useMemo(() => new Set(view.narrative?.covers ?? []), [view.narrative]);
  const overallLeader = useMemo(() => {
    const c = masterClaim(view);
    return c.kind === "lead" ? c.leader : null;
  }, [view]);
  const [pos, setPos] = useState<DeskPos>({ row: 0, col: 0 });
  const [focusHot, setFocusHot] = useState<Hot>(null);
  const [pointHot, setPointHot] = useState<Hot>(null);
  const [talk, setTalk] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const snapshot = useStripFlip(gridRef, order);
  const hot = pointHot ?? focusHot;

  const press = (row: number, col: number, h: Hot): DeskPress => ({
    tabIndex: pos.row === row && pos.col === col ? 0 : -1,
    "data-pos": `${row}:${col}`,
    onFocus: () => {
      setPos({ row, col });
      setFocusHot(h);
    },
    onPointerEnter: () => setPointHot(h),
  });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const next = moveDesk(pos, e.key, strips.length);
    if (!next) return;
    e.preventDefault();
    setPos(next);
    gridRef.current?.querySelector<HTMLElement>(`[data-pos="${next.row}:${next.col}"]`)?.focus();
  };

  const repatch = (o: PatchOrder) => {
    snapshot();
    onOrder(o);
  };

  return (
    <div className="cx-desk" data-talkback={(talk && !solo) || undefined} data-solo={solo ?? undefined}>
      <ConsoleTop view={view} words={words} order={order} onOrder={repatch} />
      <ConsoleMaster view={view} words={words} hot={hot} covered={covered} />
      <div
        ref={gridRef}
        className="cx-board"
        role="grid"
        aria-label={words.t("deskLabel", { n: strips.length })}
        aria-rowcount={DESK_ROWS}
        aria-colcount={strips.length + 1}
        style={{ "--cx-n": strips.length } as CSSProperties}
        onKeyDown={onKeyDown}
        onPointerLeave={() => setPointHot(null)}
      >
        <div className="cx-beds" aria-hidden>
          <span className="cx-bed cx-bed--head" />
          {strips.map((m) => (
            <span
              key={m.memberId}
              data-flip=""
              className="cx-bed"
              data-hot={hot?.member === m.memberId || undefined}
              data-decoy={m.decoyOf ? "" : undefined}
              data-covered={covered.has(m.memberId) || undefined}
            />
          ))}
        </div>
        <div role="row" className="cx-row cx-row--strips" aria-rowindex={1}>
          <div role="rowheader" className="cx-rowhead">
            <span className="cx-rowhead__name">{words.t("row.channels")}</span>
            <span className="cx-rowhead__meta">{words.t(order === "fit" ? "row.patchedFit" : "row.patchedNeutral")}</span>
          </div>
          {strips.map((m, c) => (
            <div role="gridcell" key={m.memberId} data-flip="" className="cx-gridcell">
              <ConsoleScribble view={view} member={m} words={words} covered={covered.has(m.memberId)} press={press(0, c, { member: m.memberId, bus: null })} onOpenReport={onOpenReport} />
            </div>
          ))}
        </div>
        {BUS_ORDER.map((bus, i) => {
          const row = i + 1;
          const leader = bus === "fit" ? overallLeader : busLeader(view, bus);
          const muted = solo !== null && solo !== bus;
          return (
            <div role="row" key={bus} className="cx-row" data-bus={bus} data-hot={hot?.bus === bus || undefined} data-muted={muted || undefined} aria-rowindex={row + 1}>
              <div role="rowheader" className="cx-rowhead">
                <ConsoleBusHead view={view} dim={bus} words={words} soloed={solo === bus} press={press(row, -1, { member: null, bus })} onSolo={(el) => onSolo(bus, null, el)} />
              </div>
              {strips.map((m, c) => {
                const props = {
                  member: m, cell: m.cells[bus], words, lead: leader === m.memberId, muted,
                  press: press(row, c, { member: m.memberId, bus }),
                  onPress: (el: HTMLElement) => onSolo(bus, m.memberId, el),
                };
                return (
                  <div role="gridcell" key={m.memberId} data-flip="" className="cx-gridcell">
                    {bus === "fit" ? (
                      <ConsoleFader {...props} noise={noise ? { lo: noise.lo, hi: noise.hi, inside: noise.ids.includes(m.memberId) } : null} />
                    ) : (
                      <ConsoleMeter {...props} />
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="cx-foot">
        <ConsoleTalkback view={view} words={words} onHot={setTalk} />
        <ConsoleLegend words={words} />
      </div>
    </div>
  );
}
