"use client";

import { useMemo, useState } from "react";
import { SearchField } from "@/app/_components/kit";
import { useSlashSearch } from "../kit/useSlashSearch";
import { searchOrbit, type OrbitModel, type SearchHit } from "./orbitModel";
import { Bead, OrbitMark } from "./OrbitMarks";
import { roleMark } from "./OrbitLanes";
import { cx } from "./orbitCx";
import type { OrbitWords } from "./orbitWords";

/**
 * One search for a role or a person, from any level (`/` focuses it). A pick lands where the thing
 * lives: a role opens its group and its ladder, a person opens their role's ladder on their stage with
 * their row marked. Arrow keys walk the results, Enter picks, Escape clears.
 */
export function OrbitSearch({ model, words, onPick }: { model: OrbitModel | null; words: OrbitWords; onPick: (hit: SearchHit) => void }) {
  const { t } = words;
  const ref = useSlashSearch();
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const hits = useMemo(() => (model ? searchOrbit(model, q, 12) : []), [model, q]);
  const pick = (h: SearchHit | undefined) => {
    if (!h) return;
    setQ("");
    onPick(h);
  };
  return (
    <span
      ref={ref}
      className="ob-search"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          // A query clears first; an empty field hands the keyboard back to the page (so Esc climbs next).
          if (q) { e.stopPropagation(); setQ(""); } else if (e.target instanceof HTMLElement) e.target.blur();
          return;
        }
        if (!hits.length) return;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          setHi((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length);
        } else if (e.key === "Enter") {
          e.preventDefault();
          pick(hits[hi]);
        }
      }}
    >
      <SearchField label={t("searchLabel")} value={q} onChange={(v) => { setQ(v); setHi(0); }} />
      {q.trim() ? (
        <ul className="ob-results" role="listbox" aria-label={t("searchResults")}>
          {hits.length === 0 ? <li className="ob-results__none">{t("searchNone", { q })}</li> : null}
          {hits.map((h, i) => {
            const cls = cx("ob-results__hit", i === hi && "is-on");
            return (
              <li key={h.type === "role" ? `r:${h.role.key}` : `p:${h.person.id}`} role="option" aria-selected={i === hi}>
                <button type="button" className={cls} onMouseDown={(e) => { e.preventDefault(); pick(h); }} tabIndex={-1}>
                  {h.type === "role" ? <OrbitMark kind={roleMark(h.role)} /> : <Bead p={h.person} as="span" />}
                  <span>
                    <b>{h.type === "role" ? h.role.title : h.person.name}</b>
                    <small>{h.type === "role" ? [h.role.family ? words.enumLabel("family", h.role.family) : null, h.role.city].filter(Boolean).join(" · ") : `${words.stage(model?.axis[h.person.si]?.id ?? "")} · ${h.role.title}`}</small>
                  </span>
                  <em>{h.type === "role" ? (h.role.act ? t("peopleN", { count: h.role.act }) : t(`abs.${h.role.absence ?? "vacant"}.short`)) : h.person.waiting ? t("searchWaiting") : ""}</em>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </span>
  );
}
