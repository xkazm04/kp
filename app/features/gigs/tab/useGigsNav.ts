"use client";

import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useTablist } from "@/app/_components/ui/useTablist";
import type { Gig, GigArena } from "@/app/_lib/gigs/types";
import { useBareKeys } from "../data/useBareKeys";
import { EMPTY_FILE, type FileFilter, type FileStatus } from "../logic/file";
import { nextInQueue } from "../logic/front";
import type { ProofList } from "../proof/GigsProof";

// Where the operator is in the Gigs tab: the section, the proof open over it (and the list
// it walks), the whole file's filter and page, the lane in focus, the page's one flash line.
// Every section and the proof REPLACE the one before; this state lives above them, so the
// way back from a proof lands where the operator left (the front page's scroll included).
// Nothing is written to the URL: `?tab=` is an inbox the shell consumes.

export const SECTIONS = ["front", "lanes", "reception", "wires"] as const;
export type Section = (typeof SECTIONS)[number];

type Proof = ProofList & { gigId: string; from: Section };
export type Flash = { tone: "info" | "critical"; text: string };

export function useGigsNav(queue: readonly Gig[]) {
  const t = useTranslations("gigs");
  const [section, setSection] = useState<Section>("front");
  const [proof, setProof] = useState<Proof | null>(null);
  const [file, setFile] = useState<FileFilter>(EMPTY_FILE);
  const [page, setPage] = useState(0);
  const [lastOpened, setLastOpened] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [focusLane, setFocusLane] = useState<string | null>(null);
  const [hireArena, setHireArena] = useState<GigArena | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const frontScroll = useRef<number | null>(null);
  const keysRef = useRef<HTMLDivElement | null>(null);

  /** The page scroller this tab sits in (the workspace scrolls a panel, not the window). */
  const scroller = useCallback((): HTMLElement | null => {
    for (let n = rootRef.current?.parentElement ?? null; n; n = n.parentElement) {
      const oy = getComputedStyle(n).overflowY;
      if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight) return n;
    }
    return (document.scrollingElement as HTMLElement | null) ?? null;
  }, []);
  const toTop = useCallback(() => {
    const s = scroller();
    if (s) s.scrollTop = Math.max(0, (rootRef.current?.offsetTop ?? 0) - 16);
  }, [scroller]);

  const goSection = useCallback(
    (s: Section) => {
      setProof(null);
      setFlash(null);
      setSection(s);
      if (s !== "lanes") {
        setFocusLane(null);
        setHireArena(null);
      }
      window.requestAnimationFrame(toTop);
    },
    [toTop]
  );
  const { tablistProps, tabProps } = useTablist({ ids: SECTIONS, active: section, onSelect: goSection, controlsPanel: false });

  const openProof = useCallback(
    (gigId: string, list: ProofList) => {
      if (!proof && section === "front") frontScroll.current = scroller()?.scrollTop ?? null;
      setFlash(null);
      setLastOpened(gigId);
      setProof({ ...list, gigId, from: proof?.from ?? section });
      window.requestAnimationFrame(toTop);
    },
    [proof, section, scroller, toTop]
  );
  const closeProof = useCallback(() => {
    const from = proof?.from ?? "front";
    setProof(null);
    setSection(from);
    // Back where the operator left the front page; the row they opened stays marked.
    window.requestAnimationFrame(() => {
      const s = scroller();
      if (from === "front" && s && frontScroll.current !== null) s.scrollTop = frontScroll.current;
    });
  }, [proof, scroller]);
  /** ← / → from a proof: the same list, another gig. */
  const stepProof = useCallback(
    (id: string) => {
      setLastOpened(id);
      setProof((p) => (p ? { ...p, gigId: id } : p));
      window.requestAnimationFrame(toTop);
    },
    [toTop]
  );
  /** The open gig left its list (declined): its neighbour, else back; and say so. */
  const leaveProof = useCallback(
    (nextId: string | null, message: string) => {
      if (nextId) stepProof(nextId);
      else closeProof();
      setFlash({ tone: "info", text: message });
    },
    [stepProof, closeProof]
  );

  const waitList = useCallback((): ProofList => ({ ids: queue.map((g) => g.id), label: t("head.waitList") }), [queue, t]);
  const openNext = useCallback(() => {
    const next = nextInQueue(queue, lastOpened);
    if (next) openProof(next.id, waitList());
    else setFlash({ tone: "info", text: t("head.nothingWaits") });
  }, [queue, lastOpened, openProof, waitList, t]);

  /** Lanes → the whole file, filtered to one lane and stage. An empty lane string is
   *  "every lane" (the exit row). */
  const openCell = useCallback(
    (lane: string, status: FileStatus) => {
      setFile({ ...EMPTY_FILE, lane: lane === "" ? null : lane, status });
      setPage(0);
      goSection("front");
      window.requestAnimationFrame(() => document.getElementById("gd-file")?.scrollIntoView({ block: "start" }));
    },
    [goSection]
  );
  const openLane = useCallback(
    (lane: string | null, arena: GigArena | null) => {
      setFocusLane(lane);
      setHireArena(arena);
      goSection("lanes");
    },
    [goSection]
  );

  // The tab's own keys: `/` finds (from any section), `N` opens the next thing that waits,
  // `?` lists the keys. A proof adds its own (←/→, Esc, D, 1-6) in proof/.
  useBareKeys((key) => {
    if (key === "/") {
      if (proof || section !== "front") goSection("front");
      window.requestAnimationFrame(() => {
        document.getElementById("gd-file")?.scrollIntoView({ block: "start" });
        searchRef.current?.focus();
        searchRef.current?.select();
      });
      return true;
    }
    if (key === "n" && !proof) {
      openNext();
      return true;
    }
    if (key === "?") {
      const el = keysRef.current as (HTMLDivElement & { togglePopover?: () => void }) | null;
      el?.togglePopover?.();
      return true;
    }
    return false;
  });

  const filterFile = (f: FileFilter) => {
    setFile(f);
    setPage(0);
  };

  return {
    // where the operator is
    section,
    proof,
    file,
    page,
    lastOpened,
    flash,
    focusLane,
    hireArena,
    // what the page binds
    rootRef,
    searchRef,
    keysRef,
    tablistProps,
    tabProps,
    // the moves
    setFlash,
    setPage,
    filterFile,
    waitList,
    goSection,
    openProof,
    closeProof,
    stepProof,
    leaveProof,
    openCell,
    openLane,
  };
}
