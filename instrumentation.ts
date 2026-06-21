// Next.js instrumentation — runs once per server process at startup. This is the
// app's clock: a heartbeat that drives the durable automation scheduler so the
// Task-7 policy pass happens on a cadence instead of only on a manual click.
//
// Safe by default: the schedule is DISABLED unless enabled via the Pipeline UI
// toggle or AUTOMATION_SCHEDULER_AUTOSTART=1, so the heartbeat ticks but does
// nothing until you opt in. An external cron hitting /api/automation/run remains
// an alternative for deployments that don't keep a long-lived Node process.
//
// The body lives in instrumentation.node.ts and is imported ONLY here, behind the
// NEXT_RUNTIME guard, so its SQLite/native imports never enter the edge/client
// compile of this hook (Next folds the guard to a constant per target and
// tree-shakes the import away — without this the bundler chases better-sqlite3 →
// bindings → `fs`, which doesn't exist off-Node).

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startClock } = await import("./instrumentation-node");
  await startClock();
}
