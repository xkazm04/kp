"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { labelize } from "@/app/_lib/format";

// Localized display label for a canonical enum/slug value. The wire value stays
// canonical English (the pipeline branches on it — stages, advance|hold|reject,
// archetype ids, role families); only the DISPLAYED label is localized. Returns
// the translation for `enums.<group>.<slug>` when present, else falls back to
// `labelize(slug)` (the prior English Title-Case behaviour) — so a slug without a
// catalog entry yet degrades gracefully instead of throwing on a missing key.
// This is the recruiter-side replacement for scattered `labelize(...)` calls.
//
// Memoized on the translator (which next-intl already memoizes over the intl
// context), so the returned labeller is a STABLE identity across renders and can
// be named in a dependency array. Several call sites already list it in a
// useMemo's deps over the whole roster — ProfileRoster's facet+row build,
// jdsLedgerLogic's option lists — and a labeller re-created every render turned
// each of those memos into a no-op: the roster re-derived its facets and
// re-collated every row on renders that changed nothing about the data.
export function useEnumLabel(): (group: string, slug: string | null | undefined) => string {
  const t = useTranslations("enums");
  return useCallback(
    (group: string, slug: string | null | undefined) => {
      const s = (slug ?? "").trim();
      if (!s) return "";
      const key = `${group}.${s}` as Parameters<typeof t>[0];
      return t.has(key) ? t(key) : labelize(s);
    },
    [t]
  );
}

// Minimal structural shape of any next-intl translator (the value from
// `useTranslations(ns)`). Generic over next-intl's `Translator` (whose call/has
// signatures only accept their own message keys, not a bare string) so this
// helper works with any namespace without coupling to one; the loose `key:
// string` is cast to the translator's key type internally.
type AnyTranslator = { (key: never): string; has: (key: never) => boolean };

// The bare `t.has(key) ? t(key) : fallback` has-fallback idiom for an OPTIONAL
// catalog entry, when the caller already holds a scoped translator and a fully
// built key. Pass the translator instance + the resolved key; returns `fallback`
// (typically the raw value) for any not-yet-translated entry. Distinct from
// useEnumLabel (which owns the `enums` namespace + labelize fallback) — this is
// the namespace-agnostic primitive for one-off optional labels.
export function labelOr<T extends AnyTranslator>(t: T, key: string, fallback: string): string {
  const k = key as Parameters<T>[0];
  return t.has(k) ? t(k) : fallback;
}
