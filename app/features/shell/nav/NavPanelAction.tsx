"use client";

// A door the group owns, rendered above its destinations.
//
// It is deliberately NOT a nav item: an action has no active state (you are
// never "in" it), no badge and no chord, and it must not look like a place you
// can return to. So it reads as a quiet row with a plus, sitting above the
// hairline that starts the list of places.
//
// Both renderer modes, same as NavPanelItem: `isLink` renders a real anchor for
// the server-rendered deep-link sidebar, and the SPA hands the href to the
// router callback it already uses for badge slices.

import Link from "next/link";
import { Plus } from "lucide-react";
import { navActionHref, type NavGroupAction } from "@/app/features/shell/tabs";

export function NavPanelAction({
  action,
  isLink,
  label,
  onNavigate,
}: {
  action: NavGroupAction;
  isLink: boolean;
  /** Already translated by the caller, which owns the catalog. */
  label: string;
  /** select mode: push the href through the shell's router. */
  onNavigate?: (href: string) => void;
}) {
  const href = navActionHref(action);
  const className =
    "focus-ring flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-steel transition-colors hover:bg-stone-50 hover:text-ink";
  const body = (
    <>
      <Plus size={16} aria-hidden className="shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
    </>
  );

  return (
    <div className="mb-1 border-b border-stone-200 pb-1">
      {isLink ? (
        <Link href={href} className={className}>
          {body}
        </Link>
      ) : (
        <button type="button" className={className} onClick={() => onNavigate?.(href)}>
          {body}
        </button>
      )}
    </div>
  );
}
