"use client";

// One row of the level-2 (panel) nav list, split out of NavSectionRail.tsx so the
// renderer stays under the 200-line file cap. Verbatim markup/logic — just the
// per-item map body behind props. Handles both renderer modes: `isLink` (real
// anchors, for the server-rendered deep-link sidebar) and the SPA's onSelect/
// onSliceNav callbacks.
import Link from "next/link";
import { navItemClass, tabHref, type WorkspaceTabDef, type WorkspaceTabId } from "@/app/features/shell/tabs";
import { TAB_ICON } from "./navMeta";

export function NavPanelItem({
  item,
  isActive,
  isLink,
  badge: rawBadge,
  showAttention = true,
  sliceHref: rawSliceHref,
  navText,
  attentionLabel,
  attentionGoLabel,
  onSelect,
  onSliceNav,
  onPrefetch,
}: {
  item: WorkspaceTabDef;
  isActive: boolean;
  isLink: boolean;
  badge: number;
  /** May this row show queue depths at all? Defaults to TRUE (today's behaviour) so
   *  no caller has to opt in. Pass `false` for a viewer who is not the workspace's
   *  operator: this nav also renders on /jds/[slug], which is on the PUBLIC proxy
   *  allow-list, and `currentWorkspace()` resolves a cookieless caller to
   *  DEFAULT_WORKSPACE — so an anonymous reader of a shared role link was served the
   *  team's real queue depths as bare integers. Enforced HERE, not only at the count
   *  source, so a future caller that hands over a populated `attention` map for a
   *  non-operator still renders no badge. */
  showAttention?: boolean;
  sliceHref: string | null;
  navText: (key: string, fallback: string) => string;
  attentionLabel: (count: number) => string;
  attentionGoLabel: (count: number) => string;
  onSelect?: (id: WorkspaceTabId) => void;
  onSliceNav?: (href: string) => void;
  /** select mode only — warm this tab's code-split chunk before the click that
   *  needs it (see shell/tabChunks.ts). Idempotent, so hover/focus can both fire. */
  onPrefetch?: (id: WorkspaceTabId) => void;
}) {
  const Icon = TAB_ICON[item.id];
  // The suppression is total: no inline pill, no slice pill, and no `pr-9` gutter
  // reserved for one — a row that cannot show a count must not look like it lost one.
  const badge = showAttention ? rawBadge : 0;
  const sliceHref = showAttention ? rawSliceHref : null;
  const rowClass = `group focus-ring relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-base font-medium transition-colors ${navItemClass(isActive)} ${sliceHref ? "pr-9" : ""}`;
  const rowInner = (
    <>
      {isActive ? (
        <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-coral" aria-hidden />
      ) : null}
      {Icon ? (
        <Icon size={17} aria-hidden className={`shrink-0 ${isActive ? "text-coral" : "text-steel group-hover:text-ink"}`} />
      ) : (
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isActive ? "bg-coral" : "bg-stone-300"}`} aria-hidden />
      )}
      <span className="min-w-0 flex-1 truncate text-left">{navText(`tabs.${item.id}`, item.label)}</span>
      {badge > 0 && !sliceHref ? (
        <span
          aria-label={attentionLabel(badge)}
          className="shrink-0 rounded-full bg-coral/10 px-1.5 py-0.5 text-sm font-semibold leading-none text-coral"
        >
          {badge}
        </span>
      ) : null}
    </>
  );
  return (
    <div className={sliceHref ? "relative" : "contents"}>
      {isLink ? (
        <Link href={tabHref(item.id)} aria-current={isActive ? "page" : undefined} className={rowClass}>
          {rowInner}
        </Link>
      ) : (
        <button
          type="button"
          aria-current={isActive ? "page" : undefined}
          onClick={() => onSelect?.(item.id)}
          // Intent, not commitment: pointing at (or tabbing to) a nav row is the
          // earliest honest signal that this tab is next, so its chunk starts
          // downloading during the ~200ms before the click instead of after it.
          // Both events, because a keyboard user never hovers.
          onPointerEnter={() => onPrefetch?.(item.id)}
          onFocus={() => onPrefetch?.(item.id)}
          className={rowClass}
        >
          {rowInner}
        </button>
      )}
      {sliceHref ? (
        isLink ? (
          <Link
            href={sliceHref}
            title={attentionGoLabel(badge)}
            aria-label={attentionGoLabel(badge)}
            className="focus-ring absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-coral/10 px-1.5 py-0.5 text-sm font-semibold leading-none text-coral hover:bg-coral/20"
          >
            {badge}
          </Link>
        ) : (
          <button
            type="button"
            title={attentionGoLabel(badge)}
            aria-label={attentionGoLabel(badge)}
            onClick={() => onSliceNav?.(sliceHref)}
            className="focus-ring absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-coral/10 px-1.5 py-0.5 text-sm font-semibold leading-none text-coral hover:bg-coral/20"
          >
            {badge}
          </button>
        )
      ) : null}
    </div>
  );
}
