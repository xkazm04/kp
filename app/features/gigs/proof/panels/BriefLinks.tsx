"use client";

import type { MouseEvent } from "react";
import { useTranslations } from "next-intl";
import { safeLinkHref } from "@/app/_components/markdown-html";
import { Mark } from "@/app/_components/kit";
import type { GigBriefLink } from "@/app/_lib/gigs/types";

/** A contents link: scroll the heading in and move focus onto it. */
export function jumpTo(e: MouseEvent<HTMLAnchorElement>, id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  e.preventDefault();
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  el.focus({ preventScroll: true });
}

/** One link the listing named: what happened to it, as a mark AND a word. A link kp did not
 *  open (blocked, skipped, failed) is text, never something to click. */
export function LinkRow({ link }: { link: GigBriefLink }) {
  const t = useTranslations("gigs");
  const flagged = link.status === "fetched" && link.reason?.startsWith("suspect:");
  const href = link.status === "fetched" ? safeLinkHref(link.url) : null;
  const label = link.title?.trim() || link.url;
  const word = t(`brief.linkStatus.${link.status}` as Parameters<typeof t>[0]);
  return (
    <li>
      <Mark kind={flagged ? "caution" : link.status === "fetched" ? "ok" : link.status === "blocked" ? "fail" : "unknown"} tip={word} />
      <span className="brief-link">
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {label}
          </a>
        ) : (
          <code>{link.url}</code>
        )}
        <span className="t-meta">
          {word}
          {flagged ? ` · ${t("brief.linkFlagged")}` : null}
          {link.reason && !flagged ? ` · ${link.reason}` : null}
          {link.chars !== null ? ` · ${t("brief.linkChars", { count: link.chars })}` : null}
        </span>
      </span>
    </li>
  );
}
