/** The first running task with a real total supplies a bounded browser-tab meter. */
export function runningTitleProgress(tasks: readonly { status: string; progressDone: number; progressTotal: number }[]): string | null {
  const task = tasks.find((t) => t.status === "running" && Number.isFinite(t.progressTotal) && t.progressTotal > 0);
  if (!task) return null;
  const done = Number.isFinite(task.progressDone) ? Math.max(0, Math.min(task.progressDone, task.progressTotal)) : 0;
  return `${done}/${task.progressTotal}`;
}
