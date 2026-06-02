"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type InfinitePhase = "initial" | "more" | "idle" | "error";

/** Normalized page every offset-paged endpoint resolves to. */
export type InfinitePage<T> = { items: T[]; total: number; hasMore: boolean; nextOffset: number };

type Options<T> = {
  /** Items requested per page. */
  pageSize: number;
  /** Build the request URL for a page starting at `offset`. Memoize it. */
  buildUrl: (offset: number, limit: number) => string;
  /** Normalize a raw JSON body into a page — endpoints name their array
   *  differently (`decisions`, `tasks`). Memoize it. Throw to signal a bad body. */
  selectPage: (body: unknown) => InfinitePage<T>;
  /** Human-facing fallback when a request fails without its own message. */
  errorLabel?: string;
  /** Grace period before the initial-load skeleton is allowed to show. A load
   *  that resolves within this window (e.g. an empty result) never flashes a
   *  skeleton, avoiding the blink of skeleton→empty on fast/empty responses. */
  skeletonDelayMs?: number;
};

// Offset-paged "load more on scroll" engine shared by the analytics Decision log
// and the Background-tasks history. Owns the accumulated items, the request
// phase, and an IntersectionObserver that auto-loads the next page as a sentinel
// nears the viewport (re-armed on each append so a tall viewport keeps paging
// until the sentinel is pushed out of view or the list is exhausted). It loads
// the first page once on mount — gate it by conditionally mounting the consumer.
// Presentation (rows, skeletons, the Load-more button) stays in each caller.
export function useInfiniteScroll<T>({ pageSize, buildUrl, selectPage, errorLabel = "Couldn't load this.", skeletonDelayMs = 300 }: Options<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [phase, setPhase] = useState<InfinitePhase>("initial");
  const [error, setError] = useState<string | null>(null);
  const [gracePassed, setGracePassed] = useState(false); // initial-skeleton grace elapsed?

  const nextOffsetRef = useRef(0); // offset to request on the next page load
  const loadingRef = useRef(false); // guards against overlapping/duplicate loads
  const hasMoreRef = useRef(true); // mirrors hasMore for the synchronous guard below
  const startedRef = useRef(false); // ensures the on-mount auto-load fires once
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadMore = useCallback(async () => {
    if (loadingRef.current) return;
    // Ignore a late observer callback fired after the final page: the about-to-be
    // -disconnected observer can still hit once before React cleans it up, which
    // would otherwise waste a request past the end. (First page is always allowed.)
    if (nextOffsetRef.current !== 0 && !hasMoreRef.current) return;
    loadingRef.current = true;
    const isInitial = nextOffsetRef.current === 0;
    if (isInitial) setGracePassed(false); // re-arm the skeleton grace for this (re)load
    setPhase(isInitial ? "initial" : "more");
    setError(null);
    try {
      const res = await fetch(buildUrl(nextOffsetRef.current, pageSize));
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok || !body || body.error) {
        throw new Error(body?.error || `Load failed (${res.status}).`);
      }
      const page = selectPage(body);
      setItems((prev) => [...prev, ...page.items]);
      setTotal(page.total);
      hasMoreRef.current = page.hasMore;
      setHasMore(page.hasMore);
      nextOffsetRef.current = page.nextOffset;
      setPhase("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : errorLabel);
      setPhase("error");
    } finally {
      loadingRef.current = false;
    }
  }, [buildUrl, pageSize, selectPage, errorLabel]);

  // First page on mount (a failed initial load is retried manually, not here).
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void loadMore();
  }, [loadMore]);

  // Hold the initial-load skeleton back until the grace window elapses. If the
  // first page resolves before then (the common case — a fast or empty result),
  // `phase` leaves "initial" and this timer is cleared, so the skeleton never
  // mounts and there's no skeleton→empty/rows blink. loadMore resets the flag
  // when an initial (re)load starts; here we only arm the reveal timer.
  useEffect(() => {
    if (phase !== "initial") return;
    const t = setTimeout(() => setGracePassed(true), skeletonDelayMs);
    return () => clearTimeout(t);
  }, [phase, skeletonDelayMs]);

  // Auto-load the next page as the sentinel scrolls near the viewport. Re-arms on
  // each append (items.length dep) so a tall viewport keeps paging.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || phase === "error") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingRef.current) void loadMore();
      },
      { rootMargin: "240px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, phase, items.length, loadMore]);

  // True only once the grace window has passed and the first page is still
  // loading — the signal callers use to render the initial skeleton.
  const showInitialSkeleton = phase === "initial" && gracePassed;

  return { items, total, hasMore, phase, showInitialSkeleton, error, sentinelRef, loadMore };
}
