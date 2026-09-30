"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import type { GigLoopQueued } from "@/app/_lib/gigs/loop";
import type { Gig } from "@/app/_lib/gigs/types";
import { sendJson } from "../data/useGigsData";
import { loopSettled, loopState, plansTaskId, queuedKey, type LoopTask, type LoopWatch } from "../logic/loop";

// The accept loop, watched from the tab (WP14): every accept or "process" answers the task ids
// it queued (PATCH /api/gigs/[id]); this store keeps them for the session and reads the task
// rows (GET /api/tasks/[id], nothing else) every few seconds until each loop settles, so the
// front page and the sign-off can say "Research being written" / "Plans being written".
//
// SESSION-ONLY by design: a reload forgets what was accepted in the tab. There is no cheaper
// honest signal - the gig row does not carry its tasks - and the durable results (the brief,
// the plan rows) are what the proof shows either way.

const POLL_MS = 4_000;
const watches = new Map<string, LoopWatch>();
let snapshot: LoopWatch[] = [];
const EMPTY: LoopWatch[] = [];
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function emit() {
  snapshot = [...watches.values()];
  for (const l of listeners) l();
}

async function readTask(id: string): Promise<LoopTask> {
  try {
    const res = await fetch(`/api/tasks/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { task?: { status?: unknown; result?: unknown } };
    const t = body.task;
    if (!t || typeof t.status !== "string") return null;
    return { status: t.status, result: t.result && typeof t.result === "object" ? (t.result as Record<string, unknown>) : null };
  } catch {
    // A missed read is retried on the next tick; the line keeps its last state meanwhile.
    return null;
  }
}

async function tick() {
  let changed = false;
  for (const w of [...watches.values()]) {
    if (loopSettled(w)) continue;
    const next = { ...w };
    if (w.research && (w.researchTask === null || !["succeeded", "failed", "canceled", "interrupted"].includes(w.researchTask.status))) {
      next.researchTask = (await readTask(w.research)) ?? w.researchTask;
    }
    const pid = plansTaskId(next);
    if (pid) next.plansTask = (await readTask(pid)) ?? w.plansTask;
    if (loopState(next) !== loopState(w)) changed = true;
    watches.set(w.gigId, next);
  }
  if (changed) emit();
  if ([...watches.values()].every(loopSettled) && timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Keep watching what an accept or "process" queued for this gig. */
export function rememberLoop(gig: Pick<Gig, "id" | "title">, queued: GigLoopQueued | null | undefined) {
  if (!queued || (!queued.research && !queued.plans)) return;
  watches.set(gig.id, { gigId: gig.id, title: gig.title, research: queued.research, plans: queued.plans, researchTask: null, plansTask: null });
  emit();
  if (!timer) timer = setInterval(() => void tick(), POLL_MS);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Every loop this session queued, oldest first. */
export function useGigLoops(): LoopWatch[] {
  return useSyncExternalStore(subscribe, () => snapshot, () => EMPTY);
}

/** Accept a New gig, or process a qualified one: the PATCH, the watch, and the flash that
 *  says what was queued. Answers the flash, or null when it failed (`error` says why). */
export function useLoopAction() {
  const t = useTranslations("gigs");
  const resolveError = useErrorMessage();
  return async (gig: Pick<Gig, "id" | "title">, action: "accept" | "process"): Promise<{ flash: string } | { error: string }> => {
    const res = await sendJson(`/api/gigs/${encodeURIComponent(gig.id)}`, "PATCH", { action });
    if (!res.ok) return { error: resolveError(res.body as ApiErrorPayload | null, t("work.actionFailed")) };
    const queued = (res.body?.queued ?? null) as GigLoopQueued | null;
    rememberLoop(gig, queued);
    const lead = action === "accept" ? t("front.new.acceptedFlash", { title: gig.title }) : t("loop.processedFlash", { title: gig.title });
    return { flash: `${lead} ${t(`loop.queued.${queuedKey(queued)}`)}` };
  };
}
