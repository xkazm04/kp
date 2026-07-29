// Shared status metadata + pure helpers for the Background-tasks tab, split out
// of TasksTab.tsx so the components stay under the 200-line file cap. Verbatim —
// same status table, same time/duration formatting, same active predicate.
import { AlertTriangle, Ban, Check, Clock, Loader2 } from "lucide-react";
import { formatRelativeTime } from "@/app/_lib/format";
import { RECENT_TASK_WINDOW_DAYS } from "@/app/_lib/tasks-window";
import type { Task, TaskStatus } from "./TasksProvider";

// Default window the live view shows; older runs page in via the history table.
// Single-sourced from tasks-window.ts (import-free) so these labels + the history
// boundary can never drift from the server's cutoff (tasks-system-operations #2).
export const RECENT_WINDOW_DAYS = RECENT_TASK_WINDOW_DAYS;
export const HISTORY_PAGE_SIZE = 20;

export type StatusMeta = {
  label: string;
  badge: string;
  Icon: typeof Check;
  iconCls: string;
};

export const STATUS: Record<TaskStatus, StatusMeta> = {
  running: { label: "Running", badge: "bg-coral/10 text-coral", Icon: Loader2, iconCls: "animate-spin text-coral" },
  queued: { label: "Queued", badge: "bg-steel/10 text-steel", Icon: Clock, iconCls: "text-steel" },
  succeeded: { label: "Done", badge: "bg-moss/10 text-moss", Icon: Check, iconCls: "text-moss" },
  failed: { label: "Failed", badge: "bg-coral/10 text-coral", Icon: AlertTriangle, iconCls: "text-coral" },
  canceled: { label: "Canceled", badge: "bg-stone-100 text-steel", Icon: Ban, iconCls: "text-steel" },
  interrupted: { label: "Interrupted", badge: "bg-amber-100 text-amber-700", Icon: AlertTriangle, iconCls: "text-amber-600" },
};

export const ACTIVE = (t: Task) => t.status === "running" || t.status === "queued";

// Tasks show "—" for a never-run/invalid timestamp; otherwise the shared
// relative-time renderer (formatRelativeTime, which returns "" on invalid).
// `locale` is the active next-intl locale, threaded from the rendering row.
export function relTime(iso: string | null, locale: string): string {
  return (iso && formatRelativeTime(iso, locale)) || "—";
}

// Wall-clock a task took (or has been running). Falls back gracefully when a
// boundary timestamp is missing rather than rendering "NaN".
export function duration(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const s = Date.parse(start);
  const e = end ? Date.parse(end) : Date.now();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null;
  const secs = Math.round((e - s) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem ? `${mins}m ${rem}s` : `${mins}m`;
}

// DATA6 — the status values the filter chips offer (terminal states only; the
// In-progress group is narrowed by kind/text but not by these).
export const FILTER_STATUSES: TaskStatus[] = ["failed", "interrupted", "succeeded", "canceled"];
