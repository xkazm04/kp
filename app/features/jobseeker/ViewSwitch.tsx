"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import "./viewSwitch.css";

// The /me VIEW switch: the same job search in two views - the Sieve (one scrolling page of eight
// chapters, /me) and the Sky Atlas (a hub with levels, /me/atlas). It sits in the header of both
// so the seeker can compare them with the same CV, the same postings and the same decisions:
// both read and write the same rows through the same API. Plain links, not state: a view is an
// address, and the page you leave keeps nothing the other needs.

export type MeView = "sieve" | "atlas";

export function ViewSwitch({ current }: { current: MeView | null }) {
  const t = useTranslations("me.views");
  const item = (view: MeView, href: string) => (
    <Link className="me-vsw-item" href={href} aria-current={current === view ? "page" : undefined} data-view={view}>
      {t(view)}
    </Link>
  );
  return (
    <nav className="me-vsw" aria-label={t("label")} data-role="view-switch">
      <span className="me-vsw-k">{t("label")}</span>
      <span className="me-vsw-seg">
        {item("sieve", "/me")}
        {item("atlas", "/me/atlas")}
      </span>
    </nav>
  );
}
