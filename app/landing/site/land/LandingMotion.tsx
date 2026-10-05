"use client";

import { useEffect, useRef, useState } from "react";

/*
 * The landing's page-level motion (prototype app.js "header, nav highlight,
 * spine" and "reveals" blocks), everything that is not one band's own:
 *
 *   - the spine: a fixed rail on the right (wide desktops only, land-landing.css)
 *     with one dot per band and Jana's card travelling down it as the page
 *     scrolls, her stage named beside it on very wide screens;
 *   - the header nav's scroll-spy: `.bar .nav a.is-cur` on the band in view
 *     (the chrome's Header leaves that class to the landing, see its comment);
 *   - reveals: the prototype's blocks settle into place as they arrive
 *     (`.rv` / `.rv.in`, gated on the root's `js` class). Reduced motion and
 *     browsers without IntersectionObserver get them in place at once.
 *
 * The header and the bands are server-rendered; this touches only classes and
 * custom properties on them, from effects, never in render, and React leaves
 * those alone on a re-render because their props do not change.
 */

export type SpineSection = { id: string; label: string; stage: string };

/** The prototype's reveal list, minus nothing: every block it slid in. */
const REVEAL = [
  ".sec-h",
  ".pp-wrap",
  ".voice-copy",
  ".voice-card",
  ".track-card",
  ".un-card",
  ".hitl",
  ".hb-r",
  ".card",
  ".pr-foot",
  ".ent-l",
  ".ent-r",
  ".stats > div",
  ".src",
  ".start-copy",
  ".dig"
].join(",");

const REDUCE = "(prefers-reduced-motion: reduce)";

export function LandingMotion({
  label,
  sampleName,
  initials,
  sections
}: {
  label: string;
  sampleName: string;
  initials: string;
  sections: readonly SpineSection[];
}) {
  const [on, setOn] = useState(false);
  const [idx, setIdx] = useState(0);
  const mark = useRef<HTMLDivElement | null>(null);
  const aside = useRef<HTMLElement | null>(null);

  // spine position + header scroll-spy
  useEffect(() => {
    const els = sections.map((s) => document.getElementById(s.id));
    const nav = Array.from(document.querySelectorAll<HTMLAnchorElement>(".bar .nav a"));
    let frame = 0;
    let last = -1;
    const paint = () => {
      frame = 0;
      const y = window.scrollY;
      setOn(y > window.innerHeight * 0.7);
      const probe = y + window.innerHeight * 0.4;
      let i = 0;
      els.forEach((el, j) => {
        if (el && el.getBoundingClientRect().top + y <= probe) i = j;
      });
      const cur = els[i];
      if (cur) {
        const top = cur.getBoundingClientRect().top + y;
        const f = i < els.length - 1 ? Math.min(1, Math.max(0, (probe - top) / cur.offsetHeight)) : 0;
        mark.current?.style.setProperty("--prog", ((i + f) / (els.length - 1)).toFixed(4));
      }
      if (i !== last) {
        last = i;
        setIdx(i);
        const hash = `#${sections[i].id}`;
        nav.forEach((a) => a.classList.toggle("is-cur", a.getAttribute("href") === hash));
      }
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(paint);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
      nav.forEach((a) => a.classList.remove("is-cur"));
    };
  }, [sections]);

  // reveals
  useEffect(() => {
    const main = aside.current?.parentElement?.querySelector("main");
    if (!main) return;
    const els = Array.from(main.querySelectorAll<HTMLElement>(REVEAL)).filter(
      (el) => !el.closest("#features, .scene")
    );
    if (window.matchMedia(REDUCE).matches || !("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("rv", "in"));
      return;
    }
    els.forEach((el) => {
      const sibs = el.parentElement ? Array.prototype.indexOf.call(el.parentElement.children, el) : 0;
      el.style.setProperty("--i", String(Math.min(4, sibs)));
      el.classList.add("rv");
    });
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -6% 0px" }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const last = sections.length - 1;
  return (
    <aside className={on ? "spine is-on" : "spine"} aria-label={label} ref={aside}>
      <ol>
        {sections.map((s, i) => (
          <li key={s.id} style={{ top: `${(i / last) * 100}%` }}>
            <a href={`#${s.id}`} aria-label={s.label} className={i === idx ? "is-cur" : undefined} />
          </li>
        ))}
      </ol>
      <div className="spine-mark" ref={mark} aria-hidden="true">
        <span className="sm-card">{initials}</span>
        <span className="sm-tag">
          <b>{sampleName}</b> <i>{sections[idx]?.stage}</i>
        </span>
      </div>
    </aside>
  );
}
