// Next.js instrumentation — runs once per server process at startup. This is the
// app's clock: a heartbeat that drives the durable automation scheduler so the
// Task-7 policy pass happens on a cadence instead of only on a manual click.
//
// Safe by default: the schedule is DISABLED unless enabled via the Pipeline UI
// toggle or AUTOMATION_SCHEDULER_AUTOSTART=1, so the heartbeat ticks but does
// nothing until you opt in. An external cron hitting /api/automation/run remains
// an alternative for deployments that don't keep a long-lived Node process.

export async function register(): Promise<void> {
  // Only run in the Node.js server runtime (not edge / not the browser).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const g = globalThis as typeof globalThis & { __kpClockStarted?: boolean };
  if (g.__kpClockStarted) return; // guard against duplicate intervals across HMR
  g.__kpClockStarted = true;

  // Eager recovery: the in-process task queue is volatile, but the `tasks` rows
  // are the source of truth — reconcile anything a previous process left mid-run.
  try {
    const { interruptStaleTasks } = await import("./app/_lib/db");
    interruptStaleTasks();
  } catch (e) {
    console.error("[clock] task recovery failed:", e);
  }

  const HEARTBEAT_MS = 60_000;
  const tick = async () => {
    try {
      const { tickScheduler } = await import("./app/_lib/scheduler");
      const r = await tickScheduler();
      if (r.ran && !r.error) console.log("[clock] policy pass ran:", JSON.stringify(r.summary));
      else if (r.error) console.error("[clock] policy pass error:", r.error);
    } catch (e) {
      console.error("[clock] tick failed:", e);
    }
  };

  setTimeout(tick, 8_000); // let the server finish booting before the first tick
  const handle = setInterval(tick, HEARTBEAT_MS);
  if (typeof (handle as { unref?: () => void }).unref === "function") {
    (handle as { unref: () => void }).unref(); // never keep the process alive for the clock alone
  }
}
