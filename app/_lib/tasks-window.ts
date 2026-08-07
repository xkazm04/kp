// Single source for the "recent tasks" window length (tasks-system-operations #2).
// Import-free so the TasksTab client component can render its "last N days" labels
// and history boundary from the SAME number the server (tasks.ts, which imports the
// db-bound run modules) uses to scope the response — a one-line change here can't
// leave the UI copy lying about its own window.
export const RECENT_TASK_WINDOW_DAYS = 7;
