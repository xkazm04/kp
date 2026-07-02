// Pins the toast queue contract (cap / dedupe / dismiss) — the pure half of the
// feedback layer. The <Toaster /> renderer itself can't load under `node --test`
// (portals + framer-motion + hooks need a bundler/DOM), so the queue logic lives
// in toast-store.ts with zero React/DOM imports and is tested here.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  TOAST_DURATION,
  TOAST_LIMIT,
  clearAllToasts,
  getToasts,
  reduceDismissToast,
  reduceShowToast,
  subscribeToasts,
  toast,
  type ToastItem,
} from "./toast-store.ts";

const item = (id: number, message = `m${id}`, variant: ToastItem["variant"] = "info"): ToastItem => ({
  id,
  variant,
  message,
  duration: 4500,
  nonce: 0,
});

/* ── reduceShowToast ─────────────────────────────────────────────────────── */

test("append: a new message is queued at the end with the provided id", () => {
  const r = reduceShowToast([item(1)], { variant: "success", message: "saved", duration: 4500 }, 2);
  assert.equal(r.id, 2);
  assert.deepEqual(
    r.toasts.map((t) => t.id),
    [1, 2]
  );
  assert.equal(r.toasts[1].variant, "success");
  assert.equal(r.toasts[1].nonce, 0);
});

test(`cap: adding beyond TOAST_LIMIT (${TOAST_LIMIT}) drops the OLDEST, keeps order`, () => {
  let toasts: ToastItem[] = [];
  for (let i = 1; i <= TOAST_LIMIT + 2; i++) {
    toasts = reduceShowToast(toasts, { variant: "info", message: `m${i}`, duration: 4500 }, i).toasts;
  }
  assert.equal(toasts.length, TOAST_LIMIT);
  // The two oldest (ids 1, 2) fell off the front; the newest survive in order.
  assert.deepEqual(
    toasts.map((t) => t.id),
    [3, 4, 5]
  );
});

test("dedupe: same variant+message bumps nonce, keeps id and stack size", () => {
  const first = reduceShowToast([], { variant: "error", message: "boom", duration: 8000 }, 1);
  const again = reduceShowToast(first.toasts, { variant: "error", message: "boom", duration: 8000 }, 2);
  assert.equal(again.id, 1, "re-fire resolves to the existing toast's id");
  assert.equal(again.toasts.length, 1);
  assert.equal(again.toasts[0].nonce, 1, "nonce bump signals the renderer to restart the timer");
  // A third fire keeps bumping.
  const third = reduceShowToast(again.toasts, { variant: "error", message: "boom", duration: 8000 }, 2);
  assert.equal(third.toasts[0].nonce, 2);
});

test("dedupe is variant-scoped: same message under another variant is a new toast", () => {
  const first = reduceShowToast([], { variant: "info", message: "done", duration: 4500 }, 1);
  const second = reduceShowToast(first.toasts, { variant: "success", message: "done", duration: 4500 }, 2);
  assert.equal(second.id, 2);
  assert.equal(second.toasts.length, 2);
});

test("dedupe keeps the toast's position (no jump to the end)", () => {
  const base = [item(1, "a"), item(2, "b"), item(3, "c")];
  const r = reduceShowToast(base, { variant: "info", message: "b", duration: 4500 }, 4);
  assert.deepEqual(
    r.toasts.map((t) => t.message),
    ["a", "b", "c"]
  );
  assert.equal(r.id, 2);
});

/* ── reduceDismissToast ──────────────────────────────────────────────────── */

test("dismiss removes exactly the matching id", () => {
  const r = reduceDismissToast([item(1), item(2), item(3)], 2);
  assert.deepEqual(
    r.map((t) => t.id),
    [1, 3]
  );
});

test("dismissing an unknown id is a no-op returning the SAME reference", () => {
  const base = [item(1)];
  assert.equal(reduceDismissToast(base, 99), base);
});

/* ── module store behavior ───────────────────────────────────────────────── */

beforeEach(() => {
  clearAllToasts();
});

test("store: toast.success queues with the variant default duration and returns an id", () => {
  const id = toast.success("saved");
  const queued = getToasts();
  assert.equal(queued.length, 1);
  assert.equal(queued[0].id, id);
  assert.equal(queued[0].duration, TOAST_DURATION.success);
  assert.equal(TOAST_DURATION.error > TOAST_DURATION.success, true, "errors linger longer by default");
});

test("store: duplicate fire returns the original id and notifies subscribers", () => {
  let notified = 0;
  const unsubscribe = subscribeToasts(() => notified++);
  const a = toast.error("boom");
  const b = toast.error("boom");
  unsubscribe();
  assert.equal(a, b);
  assert.equal(getToasts().length, 1);
  assert.equal(notified, 2, "the dedupe re-fire still emits (nonce changed)");
});

test("store: dismiss removes and notifies; unknown id does not notify", () => {
  const id = toast.info("hello");
  let notified = 0;
  const unsubscribe = subscribeToasts(() => notified++);
  toast.dismiss(999);
  assert.equal(notified, 0, "no-op dismiss is silent");
  toast.dismiss(id);
  unsubscribe();
  assert.equal(notified, 1);
  assert.deepEqual(getToasts(), []);
});

test("store: snapshot reference only changes when the queue changes", () => {
  toast.info("a");
  const before = getToasts();
  toast.dismiss(123456); // unknown id — no-op
  assert.equal(getToasts(), before);
  toast.info("b");
  assert.notEqual(getToasts(), before);
});

test("store: cap holds end-to-end (oldest evicted)", () => {
  for (let i = 0; i < TOAST_LIMIT + 1; i++) toast.info(`msg ${i}`);
  const queued = getToasts();
  assert.equal(queued.length, TOAST_LIMIT);
  assert.equal(queued[0].message, "msg 1", "msg 0 was evicted");
});
