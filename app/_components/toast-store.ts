// Toast queue store — the data half of the app's success/error feedback layer
// (the portal renderer is app/_components/Toast.tsx). A module-level
// subscribable store in the style of app/_lib/theme.ts: `toast.success(...)` /
// `toast.error(...)` / `toast.info(...)` can be called from any client code
// (event handlers, .catch sites) without threading a context, and the single
// <Toaster /> mounted in app/layout.tsx renders whatever is queued.
//
// The queue CONTRACT lives in the pure reducers below (no React, no DOM) so it
// is unit-testable under `node --test` (toast-store.test.ts):
//   - cap: at most TOAST_LIMIT toasts; adding beyond it drops the OLDEST,
//   - dedupe: re-firing an identical variant+message does not grow the stack —
//     it bumps the existing toast's `nonce` (the renderer restarts its
//     auto-dismiss timer) and returns the existing id,
//   - dismiss: removal by id; unknown ids are a no-op (same array reference,
//     so the store can skip notifying subscribers).

export type ToastVariant = "success" | "error" | "info";

export type ToastItem = {
  id: number;
  variant: ToastVariant;
  message: string;
  /** Auto-dismiss window in ms. */
  duration: number;
  /** Bumped when a duplicate re-fires, so the renderer restarts the timer. */
  nonce: number;
};

/** Max simultaneously stacked toasts; the oldest is dropped beyond it. */
export const TOAST_LIMIT = 3;

/** Default auto-dismiss windows — errors linger longer than confirmations. */
export const TOAST_DURATION: Record<ToastVariant, number> = {
  success: 4500,
  info: 4500,
  error: 8000,
};

/* ── Pure reducers (the tested contract) ─────────────────────────────────── */

export function reduceShowToast(
  toasts: readonly ToastItem[],
  input: { variant: ToastVariant; message: string; duration: number },
  nextId: number
): { toasts: ToastItem[]; id: number } {
  const dup = toasts.find((t) => t.variant === input.variant && t.message === input.message);
  if (dup) {
    return {
      toasts: toasts.map((t) => (t === dup ? { ...t, duration: input.duration, nonce: t.nonce + 1 } : t)),
      id: dup.id,
    };
  }
  const appended = [...toasts, { id: nextId, variant: input.variant, message: input.message, duration: input.duration, nonce: 0 }];
  return {
    toasts: appended.length > TOAST_LIMIT ? appended.slice(appended.length - TOAST_LIMIT) : appended,
    id: nextId,
  };
}

/** Returns the SAME array reference when `id` isn't queued (no-op signal). */
export function reduceDismissToast(toasts: ToastItem[], id: number): ToastItem[] {
  const remaining = toasts.filter((t) => t.id !== id);
  return remaining.length === toasts.length ? toasts : remaining;
}

/* ── Module store (subscribable, useSyncExternalStore-shaped) ────────────── */

let toasts: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function getToasts(): ToastItem[] {
  return toasts;
}

// Server snapshot: nothing is ever queued during SSR; a stable reference keeps
// useSyncExternalStore from re-rendering on every getServerSnapshot call.
const EMPTY: ToastItem[] = [];
export function getServerToasts(): ToastItem[] {
  return EMPTY;
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function show(variant: ToastVariant, message: string, opts?: { duration?: number }): number {
  const result = reduceShowToast(toasts, { variant, message, duration: opts?.duration ?? TOAST_DURATION[variant] }, nextId);
  if (result.id === nextId) nextId++;
  toasts = result.toasts;
  emit();
  return result.id;
}

export const toast = {
  /** Confirmation of a completed mutation. Returns the toast id. */
  success: (message: string, opts?: { duration?: number }): number => show("success", message, opts),
  /** A failure the user must know about (announced assertively). */
  error: (message: string, opts?: { duration?: number }): number => show("error", message, opts),
  /** Neutral notice. */
  info: (message: string, opts?: { duration?: number }): number => show("info", message, opts),
  /** Manual removal (dismiss button / auto-dismiss timer). */
  dismiss(id: number): void {
    const next = reduceDismissToast(toasts, id);
    if (next === toasts) return;
    toasts = next;
    emit();
  },
};

/** Empty the queue (route-level resets, test isolation). */
export function clearAllToasts(): void {
  if (toasts.length === 0) return;
  toasts = [];
  emit();
}
