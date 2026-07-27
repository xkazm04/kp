import { after } from "next/server";

// Best-effort work that must NOT sit on a request's critical path.
//
// The motivating case is the application acknowledgement: an inbound SMTP/relay
// round-trip (retries and all) was `await`ed between "the entry is filed" and
// "the applicant gets their response", so a slow provider showed up as a slow —
// or, at the timeout, apparently broken — apply form for a submission that had
// already fully succeeded. The work is already best-effort (its failure is
// logged and never changes the outcome), which is exactly the profile `after`
// exists for.
//
// `after` (next/server, stable since 15.1) is the sanctioned post-response hook
// for Route Handlers: on a Node server the callback runs after the response is
// finished, and on serverless it extends the invocation via waitUntil — a plain
// detached promise would be killed with the invocation there. See
// node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md.
//
// Two guarantees this wrapper adds over calling `after` directly:
//   - a task that throws is LOGGED, never an unhandled rejection;
//   - scheduling itself can't break the response. `after` throws when there is
//     no request context (a CLI script, a direct lib call in a test); the task
//     then runs detached instead. Deferred work must never be the reason a
//     candidate sees an error for an application that already succeeded.
export function afterResponse(label: string, task: () => Promise<unknown>): void {
  const run = async (): Promise<void> => {
    try {
      await task();
    } catch (err) {
      console.error(`[after:${label}]`, err instanceof Error ? err.message : err);
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}
