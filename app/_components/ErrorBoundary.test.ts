import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidElement, type ReactNode } from "react";
import { ErrorBoundary, type BoundaryMessages } from "./ErrorBoundary.ts";

// The one surface a Czech recruiter meets when a tab fails was the only shell
// string outside the catalogs — hardcoded English inside a class component's
// render. The strings now arrive as a prop, which is also what makes the fallback
// testable without a DOM: the class is instantiated directly and its element tree
// is walked.

const MESSAGES: BoundaryMessages = {
  title: "Něco se tu pokazilo",
  body: "Tuto kartu se nepodařilo zobrazit.",
  retry: "Zkusit znovu",
  report: "Nahlásit chybu",
  reporting: "Odesílání hlášení",
  reportSent: "Hlášení odesláno",
  reportFailed: "Hlášení se nepodařilo odeslat",
};

/** Every string in a React element tree, in render order. */
function textOf(node: ReactNode): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(textOf);
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return [];
}

const boundary = (resetKey: unknown) => new ErrorBoundary({
  children: "the tab", messages: MESSAGES, resetKey, label: "tab", resolveReportError: (_payload, fallback) => fallback,
});

test("with no error the children render untouched", () => {
  const b = boundary("pipeline");
  assert.deepEqual(textOf(b.render()), ["the tab"]);
});

test("a caught error renders the fallback — every string from the catalog, none baked in", () => {
  const b = boundary("pipeline");
  b.state = { ...b.state, ...ErrorBoundary.getDerivedStateFromError(new Error("payload shape drifted")) };
  const text = textOf(b.render());
  assert.deepEqual(text, [MESSAGES.title, MESSAGES.body, MESSAGES.retry, MESSAGES.report]);
  // The thrown message is server/dev diagnosis; it never reaches the reader.
  assert.equal(text.join(" ").includes("payload shape drifted"), false);
});

test("the fallback is announced — role=alert on the panel", () => {
  const b = boundary("pipeline");
  b.state = { ...b.state, ...ErrorBoundary.getDerivedStateFromError(new Error("x")) };
  const el = b.render();
  assert.ok(isValidElement<{ role?: string }>(el));
  assert.equal(el.props.role, "alert");
});

// The tab-switch contract: the destination must not inherit the previous tab's
// fallback.
test("a changed resetKey clears the caught error", () => {
  const b = boundary("analytics");
  b.state = { ...b.state, ...ErrorBoundary.getDerivedStateFromError(new Error("x")) };
  let next: unknown = null;
  b.setState = ((s: unknown) => {
    next = s;
  }) as typeof b.setState;
  b.componentDidUpdate({ ...b.props, children: null, resetKey: "pipeline" });
  assert.deepEqual(next, { error: null, report: "idle", reportError: null });
});

test("an unchanged resetKey keeps the fallback — a re-render is not a recovery", () => {
  const b = boundary("analytics");
  b.state = { ...b.state, ...ErrorBoundary.getDerivedStateFromError(new Error("x")) };
  let called = false;
  b.setState = (() => {
    called = true;
  }) as typeof b.setState;
  b.componentDidUpdate({ ...b.props, children: null, resetKey: "analytics" });
  assert.equal(called, false);
});

test("report sends the panel location without the thrown message", async () => {
  const b = boundary("analytics");
  b.state = { ...b.state, error: new Error("private payload shape") };
  b.setState = ((update: object) => {
    b.state = { ...b.state, ...update };
  }) as typeof b.setState;
  const originalFetch = globalThis.fetch;
  const originalWindow = (globalThis as { window?: unknown }).window;
  let body: { message: string; route: string } | undefined;
  (globalThis as { window?: unknown }).window = { location: { pathname: "/control" } };
  globalThis.fetch = (async (_url, init) => {
    body = JSON.parse(String(init?.body)) as typeof body;
    return { ok: true } as Response;
  }) as typeof fetch;
  try {
    await (b as unknown as { sendReport(): Promise<void> }).sendReport();
    assert.deepEqual(body, { message: "Workspace tab crash", route: "/control" });
    assert.equal(b.state.report, "sent");
    assert.deepEqual(textOf(b.render()).at(-1), MESSAGES.reportSent);
  } finally {
    globalThis.fetch = originalFetch;
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});
