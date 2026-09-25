"use client";

import { useEffect, useState } from "react";
import type { Entry } from "@/app/features/shared/pipelineTypes";

export type RejectedTag = { stage: string; auto: boolean };
export type Shelf = { rows: Entry[]; tags: ReadonlyMap<string, RejectedTag>; status: "loading" | "ready" | "error" };

type Loaded = Shelf & { key: string };
const IDLE: Loaded = { rows: [], tags: new Map(), status: "ready", key: "" };

/**
 * The rejected shelf (the retired board's per-lane shelf, GET /api/pipeline/rejected?lane=): rejected
 * rows stay off the board payload, so picking the Sieve's exit layer fetches them, one request per lane
 * that has any (only the picked role's lane when level 2 is one role), and lists them with the stage
 * they left from and whether the AI or a person rejected them. Nothing is fetched until the layer is
 * picked; a failed read says so instead of listing nobody.
 */
export function useRejectedShelf(active: boolean, rejectedByLane: Record<string, number>, lane: string | null): Shelf & { retry: () => void } {
  const [shelf, setShelf] = useState<Loaded>(IDLE);
  const [tick, setTick] = useState(0);
  const lanes = Object.keys(rejectedByLane)
    .filter((key) => rejectedByLane[key] > 0)
    .filter((key) => !lane || key === lane)
    .sort();
  const key = active ? `${lanes.join("|")}#${tick}` : "";

  useEffect(() => {
    if (!key) return;
    let live = true;
    const want = key.split("#")[0].split("|").filter(Boolean);
    Promise.all(
      want.map(async (lane) => {
        const r = await fetch(`/api/pipeline/rejected?lane=${encodeURIComponent(lane)}`);
        if (!r.ok) throw new Error(String(r.status));
        const d = (await r.json()) as { rejected?: { entry: Entry; rejectedStage: string | null; auto: boolean }[] };
        return d.rejected ?? [];
      })
    )
      .then((groups) => {
        if (!live) return;
        const all = groups.flat();
        setShelf({ key, rows: all.map((x) => x.entry), tags: new Map(all.map((x) => [x.entry.id, { stage: x.rejectedStage ?? x.entry.stage, auto: x.auto }])), status: "ready" });
      })
      .catch(() => {
        if (live) setShelf({ ...IDLE, key, status: "error" });
      });
    return () => {
      live = false;
    };
  }, [key]);

  // Until the answer for THIS key lands the shelf is loading (never a stale role's list); inactive = empty.
  if (!active) return { ...IDLE, retry: () => undefined };
  if (shelf.key !== key) return { ...IDLE, status: "loading", retry: () => undefined };
  return { ...shelf, retry: () => setTick((n) => n + 1) };
}
