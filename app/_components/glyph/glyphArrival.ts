// Arrival: the empty state that is about to stop being empty.
//
// An empty tab has two honest readings — "nothing is coming" and "it is on its way"
// — and before this module the Decisions tab only had the first: while an AI screen
// of a whole column ran, it said "You're all caught up" and offered two ways out.
// The client already polls the tasks that fill the queue, so the distinction costs
// no new endpoint. This file is the seam that decides it, pure so node:test can:
//
//   ARRIVAL_KINDS   tab -> the task kinds that DEPOSIT into that tab. A tab opts in
//                   only once its deposit path is verified from source (batch_screen
//                   and automation write the advance/hold decisions the Decisions
//                   queue reads — app/_lib/tasks.ts). A false "arriving" is the
//                   same lie as a false "caught up", turned around.
//   resolveArrival  idle | arriving{count, done, total} from the polled list.
//   stepArrival     the same, plus the edge a surface must reload on. useLiveRefresh
//                   fires only on kp:data-changed from UI mutators, never when a
//                   background task writes, so without this edge "arriving" would
//                   hand over to "caught up" with the new decisions unrendered.
//
// Imports are the two closed vocabularies only (both already on the page graph);
// the task shape is structural so this module never reaches into the shell.
import type { TaskKind } from "@/app/_lib/task-kinds";
import type { GlyphRegistryTabId } from "./glyphRegistry";
import type { AmbientPresetName } from "./motionPresets";

export const ARRIVAL_KINDS = {
  decisions: ["batch_screen", "automation"],
} as const satisfies Partial<Record<GlyphRegistryTabId, readonly TaskKind[]>>;

/** The slice of a polled task this module reads (TasksProvider's `Task` fits it). */
export type ArrivalTask = {
  id: string;
  kind: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled" | "interrupted";
  progressDone: number;
  progressTotal: number;
};

export type ArrivalInput = {
  tab: string;
  tasks: readonly ArrivalTask[];
  /** TasksProvider's `loadFailed`: the list is a frozen snapshot, not the queue. */
  loadFailed: boolean;
};

export type Arrival =
  | { mode: "idle" }
  | { mode: "arriving"; count: number; done: number; total: number };

/** What a surface remembers between polls: each watched task's last `done`. */
export type ArrivalWatch = { readonly done: Readonly<Record<string, number>> };

export const EMPTY_ARRIVAL_WATCH: ArrivalWatch = { done: {} };

/** The one ambient an arrival earns — `pulse`, whose contract is "only where work
 *  really is happening". motionPresets.test.ts counts `ambientFor(` as its render site. */
export const ARRIVAL_AMBIENT = "pulse" as const satisfies AmbientPresetName;

const IDLE: Arrival = { mode: "idle" };

/** Same predicate as the provider's ACTIVE (tasksProviderTypes.ts); the test pins that. */
const inFlight = (t: ArrivalTask) => t.status === "running" || t.status === "queued";

function kindsFor(tab: string): readonly string[] {
  return Object.hasOwn(ARRIVAL_KINDS, tab) ? ARRIVAL_KINDS[tab as keyof typeof ARRIVAL_KINDS] : [];
}

function arriving(input: ArrivalInput): ArrivalTask[] {
  if (input.loadFailed) return [];
  const kinds = kindsFor(input.tab);
  if (kinds.length === 0) return [];
  return input.tasks.filter((t) => inFlight(t) && kinds.includes(t.kind));
}

function summarize(tasks: readonly ArrivalTask[]): Arrival {
  if (tasks.length === 0) return IDLE;
  let done = 0;
  let total = 0;
  for (const t of tasks) {
    // A queued automation run reports 0/0 — it has no fraction to add.
    if (t.progressTotal > 0) {
      done += t.progressDone;
      total += t.progressTotal;
    }
  }
  return { mode: "arriving", count: tasks.length, done, total };
}

export function resolveArrival(input: ArrivalInput): Arrival {
  return summarize(arriving(input));
}

/**
 * One poll's worth of arrival: the state to render, what to remember, and whether
 * work landed since the last poll — a watched task left the in-flight set (finished,
 * failed, canceled, or aged out of the window) or reported another item done. It
 * fires once per edge: stepping again with the same input never reloads twice.
 * A failed poll is not evidence that anything finished, so it keeps the watch.
 */
export function stepArrival(
  prev: ArrivalWatch,
  input: ArrivalInput,
): { arrival: Arrival; watch: ArrivalWatch; reload: boolean } {
  if (input.loadFailed) return { arrival: IDLE, watch: prev, reload: false };
  const now = arriving(input);
  const done: Record<string, number> = {};
  for (const t of now) done[t.id] = t.progressDone;
  let reload = false;
  for (const [id, was] of Object.entries(prev.done)) {
    if (!Object.hasOwn(done, id) || done[id] > was) {
      reload = true;
      break;
    }
  }
  return { arrival: summarize(now), watch: { done }, reload };
}

export function ambientFor(arrival: Arrival): AmbientPresetName | undefined {
  return arrival.mode === "arriving" ? ARRIVAL_AMBIENT : undefined;
}
