"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { Modal } from "@/app/_components/Modal";
import { buildTabSwitchUrl, buildUrl, clearedTabScopedParams, NAV_GROUPS, type WorkspaceTabId } from "./tabs";

// SHELL1 — the global command palette: one Ctrl/Cmd+K surface that searches
// candidates, pipeline entries, jobs, saved JDs and analyses (via /api/search)
// and doubles as a tab navigator (actions derived from NAV_GROUPS). Enter (or a
// click) navigates through the SAME deep links the rest of the app uses, so the
// palette can never land somewhere a sidebar click couldn't.

type SearchHit = { type: "profile" | "entry" | "job" | "jd" | "analysis"; id: string; label: string; sub: string | null };
type PaletteItem = { key: string; group: string; label: string; sub: string | null; href: string };

const DEBOUNCE_MS = 200;
// Hit order mirrors how a recruiter recalls things: people first, then roles.
const HIT_TYPE_ORDER: SearchHit["type"][] = ["profile", "entry", "job", "jd", "analysis"];

function hitHref(hit: SearchHit, search: string): string {
  switch (hit.type) {
    case "profile":
      return buildUrl({ ...clearedTabScopedParams(), tab: "match", profile: hit.id }, search);
    case "entry":
      // No per-entry deep link exists; the board's ?q= filter (ANA1) isolates
      // the candidate by label — same place the drawer opens from.
      return buildUrl({ ...clearedTabScopedParams(), tab: "pipeline", q: hit.label }, search);
    case "job":
      return buildUrl({ ...clearedTabScopedParams(), tab: "jobs", job: hit.id }, search);
    case "jd":
      return `/jds/${encodeURIComponent(hit.id)}`;
    case "analysis":
      return `/history/${encodeURIComponent(hit.id)}`;
  }
}

export function CommandPalette() {
  const t = useTranslations("palette");
  const nav = useTranslations("nav");
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // The server renders "Ctrl K"; an Apple client computes "⌘K" at hydration.
  // suppressHydrationWarning on the <kbd> below owns that known, intentional
  // mismatch — no state/effect needed for a value that never changes after load.
  const kbdHint = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K";

  // Opening always starts from a clean slate (reset in the event handlers, not
  // an effect, so a stale query/result list never flashes and no synchronous
  // set-state-in-effect is needed).
  const openPalette = useCallback(() => {
    setQuery("");
    setHits([]);
    setError(null);
    setSelected(0);
    setOpen(true);
  }, []);

  // Mirror `open` into a ref so the document-level shortcut handler (bound
  // once) can branch on the current value without re-binding per toggle.
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // The global shortcut. Fires everywhere — including inside inputs (the
  // palette IS the escape hatch) — but never while typing means losing work:
  // preventDefault stops the browser's own Ctrl+K (search-bar focus).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (openRef.current) setOpen(false);
        else openPalette();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openPalette]);

  // Modal's focus trap lands on its first focusable (the header close button);
  // a rAF runs after that effect, so the input wins the opening focus.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Debounced server search. Aborts the in-flight request on every keystroke
  // and on close, so a slow earlier response can't clobber a newer result set.
  // Sub-minimum queries never reach here — the onChange handler clears hits
  // synchronously (an event, not an effect), so this effect only schedules
  // async work and sets state from its callbacks.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then(async (r) => {
          const body = (await r.json().catch(() => null)) as { results?: SearchHit[]; error?: string } | null;
          if (controller.signal.aborted) return;
          if (!r.ok || !body || body.error) {
            setError(body?.error ?? t("searchFailed"));
            return;
          }
          setError(null);
          setHits(Array.isArray(body.results) ? body.results : []);
        })
        .catch(() => {
          if (!controller.signal.aborted) setError(t("searchFailed"));
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, t]);

  // Localized tab label with the same has-fallback contract Workspace uses.
  const tabLabel = (id: WorkspaceTabId, fallback: string): string => {
    const key = `tabs.${id}` as Parameters<typeof nav>[0];
    return nav.has(key) ? nav(key) : fallback;
  };

  const items = useMemo<PaletteItem[]>(() => {
    const q = query.trim().toLowerCase();
    const out: PaletteItem[] = [];
    // Jump-to-tab actions: all of them on an empty query (the palette's resting
    // state is a navigator), narrowed by label/id match while typing.
    for (const def of NAV_GROUPS.flatMap((g) => g.items)) {
      const label = tabLabel(def.id, def.label);
      if (!q || label.toLowerCase().includes(q) || def.id.includes(q)) {
        out.push({ key: `tab-${def.id}`, group: "tabs", label, sub: null, href: buildTabSwitchUrl(def.id, search) });
      }
    }
    for (const type of HIT_TYPE_ORDER) {
      for (const hit of hits.filter((h) => h.type === type)) {
        out.push({ key: `${hit.type}-${hit.id}`, group: hit.type, label: hit.label, sub: hit.sub, href: hitHref(hit, search) });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tabLabel is stable per locale; nav/t hooks re-render on locale change anyway
  }, [query, hits, search]);

  // Clamp the highlight whenever the list shrinks under it.
  const active = Math.min(selected, Math.max(0, items.length - 1));

  const go = (item: PaletteItem) => {
    setOpen(false);
    router.push(item.href);
  };

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected(Math.min(active + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected(Math.max(active - 1, 0));
    } else if (e.key === "Enter" && items[active]) {
      e.preventDefault();
      go(items[active]);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={openPalette}
        className="focus-ring flex w-full items-center gap-2 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-left text-sm text-steel hover:border-coral/40 hover:text-ink"
      >
        <Search size={14} aria-hidden />
        <span className="flex-1 truncate">{t("trigger")}</span>
        <kbd suppressHydrationWarning className="rounded border border-stone-200 bg-paper px-1.5 py-0.5 text-[11px] font-semibold text-steel">
          {kbdHint}
        </kbd>
      </button>

      {open ? (
        <Modal title={t("title")} onClose={() => setOpen(false)} size="xl">
          <div className="space-y-3">
            <input
              ref={inputRef}
              type="search"
              role="combobox"
              aria-expanded={items.length > 0}
              aria-controls="palette-results"
              aria-activedescendant={items[active] ? `palette-item-${active}` : undefined}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelected(0);
                if (e.target.value.trim().length < 2) {
                  setHits([]);
                  setError(null);
                }
              }}
              onKeyDown={onInputKey}
              placeholder={t("placeholder")}
              className="focus-ring h-10 w-full rounded-md border border-stone-200 px-3 text-base"
            />
            {error ? <p className="text-sm text-coral">{error}</p> : null}
            <ul id="palette-results" role="listbox" aria-label={t("title")} className="max-h-[50vh] space-y-0.5 overflow-y-auto">
              {items.map((item, i) => {
                const groupStart = i === 0 || items[i - 1].group !== item.group;
                return (
                  <li key={item.key}>
                    {groupStart ? (
                      <p className="mt-2 px-2 text-meta uppercase text-steel first:mt-0">
                        {t(`groups.${item.group}` as Parameters<typeof t>[0])}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      id={`palette-item-${i}`}
                      role="option"
                      aria-selected={i === active}
                      onClick={() => go(item)}
                      onMouseMove={() => setSelected(i)}
                      className={`focus-ring flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-base ${
                        i === active ? "bg-coral/10 text-ink" : "text-ink hover:bg-paper"
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.sub ? <span className="shrink-0 truncate text-sm text-steel">{item.sub}</span> : null}
                    </button>
                  </li>
                );
              })}
              {items.length === 0 ? (
                <li className="px-2 py-3 text-base text-steel">
                  {query.trim().length >= 2 && !error ? t("noResults", { q: query.trim() }) : t("empty")}
                </li>
              ) : null}
            </ul>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
