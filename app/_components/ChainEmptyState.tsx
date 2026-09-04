"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { PANEL_SUNKEN } from "./ui/recipes";
import { MotionizedGlyph, type TracedGlyph } from "./glyph/MotionizedGlyph";
import { GLYPH_SIZE } from "./glyph/glyphSizes";
import { buildTabSwitchUrl, type WorkspaceTabId } from "@/app/features/shell/tabs";

// Chain-aware empty state: an empty tab explains WHERE its data comes from and
// links to the upstream step instead of dead-ending ("no candidates" → set up a
// channel; "nothing to schedule" → accept a screening in Decisions). The hiring
// chain it teaches: JD (library) → job (jobs) → channel (channels) → candidates
// (pipeline) → decisions → schedule → offer/hired. Each call site declares its
// own upstream link(s) — the copy lives in that tab's catalog namespace, the
// navigation always goes through buildTabSwitchUrl so the destination opens
// clean. Client-only: meant for tab bodies inside the Workspace SPA.
export function ChainEmptyState({
  icon: Icon,
  glyph,
  title,
  body,
  links,
  extraAction,
}: {
  icon?: LucideIcon;
  // A /motionize traced glyph (app/_components/glyph/glyphs/), rendered instead of
  // the lucide `icon`. Reserved for the first-run "nothing here yet" case — a
  // self-drawing illustration on a filtered-to-zero list is noise, so those call
  // sites keep the flat icon.
  glyph?: TracedGlyph;
  title: string;
  body?: string;
  links: { tab: WorkspaceTabId; label: string }[];
  // Non-navigation affordance rendered alongside the links (e.g. the Pipeline
  // empty state's "watch the hiring story" tour trigger).
  extraAction?: React.ReactNode;
}) {
  const router = useRouter();
  const search = useSearchParams();
  return (
    <div className={`${PANEL_SUNKEN} p-6 text-center`}>
      {glyph ? (
        <MotionizedGlyph data={glyph.data} viewBox={glyph.viewBox} className={`mx-auto ${GLYPH_SIZE.lg}`} />
      ) : Icon ? (
        <Icon className="mx-auto text-moss" size={28} aria-hidden />
      ) : null}
      <p className={`text-base font-semibold text-ink ${Icon || glyph ? "mt-2" : ""}`}>{title}</p>
      {body ? <p className="mx-auto mt-1 max-w-lg text-sm text-steel">{body}</p> : null}
      {links.length > 0 || extraAction ? (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
          {links.map((link) => (
            <button
              key={link.tab}
              type="button"
              onClick={() => router.push(buildTabSwitchUrl(link.tab, search.toString()))}
              className="focus-ring inline-flex items-center gap-1 text-sm font-semibold text-coral hover:underline"
            >
              {link.label} <ArrowRight size={13} aria-hidden />
            </button>
          ))}
          {extraAction ?? null}
        </div>
      ) : null}
    </div>
  );
}
