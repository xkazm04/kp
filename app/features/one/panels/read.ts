"use client";

// The one read primitive every /one panel uses — GET an EXISTING route, fold the answer
// into loading / ready / error, never into a calm empty list.
//
// Three rules it holds for every panel at once:
//   - a non-OK answer keeps its body (`{ code }`), so the panel resolves the CODE through
//     useErrorMessage() in the reader's language and never paints the server's English
//     `error` string (sharedGetJson throws the body away, which is why this is not it);
//   - a body the parser does not recognise is an error, not "nothing here" — a composed
//     screen that renders one module's silent failure as empty is the most misleading
//     thing it can show (composition-region, "unknown is not a value");
//   - two panels mounting together on the same URL share ONE request (several views read
//     /api/pipeline); `epoch` is bumped after a data act so every view re-reads.
import { useEffect, useState } from "react";
import type { ApiErrorPayload } from "@/app/_lib/use-error-message";

export type Read<T> =
  | { state: "loading" }
  | { state: "ready"; data: T }
  | { state: "error"; payload: ApiErrorPayload | null };

type Raw = { ok: boolean; body: unknown };

const inflight = new Map<string, Promise<Raw>>();

function getShared(url: string, key: string): Promise<Raw> {
  const hit = inflight.get(key);
  if (hit) return hit;
  const p = fetch(url, { cache: "no-store" })
    .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => null) }))
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

const asPayload = (body: unknown): ApiErrorPayload | null =>
  body != null && typeof body === "object" && typeof (body as { code?: unknown }).code === "string" ? { code: (body as { code: string }).code } : null;

/** GET `url` (null = nothing to read yet) and parse it. `parse` returns null for a body it
 *  does not recognise, which is folded into the error state. */
export function useRead<T>(url: string | null, parse: (body: unknown) => T | null, epoch: number): Read<T> & { retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const key = url ? `${url}#${epoch}#${attempt}` : null;
  // The settled answer is stored WITH the key it answers, so a newer key reads as loading
  // without a synchronous setState in the effect, and a late answer for an old key is
  // simply never shown.
  const [settled, setSettled] = useState<{ key: string; read: Read<T> } | null>(null);
  useEffect(() => {
    if (!url || !key) return;
    let live = true;
    getShared(url, key)
      .then((raw) => {
        if (!live) return;
        if (!raw.ok) return setSettled({ key, read: { state: "error", payload: asPayload(raw.body) } });
        const data = parse(raw.body);
        setSettled({ key, read: data === null ? { state: "error", payload: null } : { state: "ready", data } });
      })
      .catch(() => {
        if (live) setSettled({ key, read: { state: "error", payload: null } });
      });
    return () => {
      live = false;
    };
    // `parse` must be a module-level function (stable identity); the key carries the rest.
  }, [key, url, parse]);
  const retry = () => setAttempt((n) => n + 1);
  const read: Read<T> = settled && settled.key === key ? settled.read : { state: "loading" };
  return { ...read, retry };
}

/** A count the read did not return renders as a dash, never 0. */
export const isCount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
