"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { MessageSquarePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { railTile } from "@/app/_components/ui/recipes";
import { navLabel, type WorkspaceTabId } from "../tabs";

// The dialog is only ever needed after a click, so it is its own chunk; hovering or
// focusing the button starts the download, so the click itself does not wait on it.
const loadFeedbackDialog = () => import("./FeedbackDialog");
const FeedbackDialog = dynamic(() => loadFeedbackDialog().then((m) => ({ default: m.FeedbackDialog })));
const preloadFeedbackDialog = () => {
  void loadFeedbackDialog().catch(() => {
    // Best-effort warm-up: the click imports it for real and surfaces a failure there.
  });
};

/*
 * The rail's "Send feedback" affordance, in the SAME icon-over-label shape as the
 * rail's Search trigger and the section buttons above it — the rail is the
 * wayfinding surface, and a door that only appears on hover is a door most
 * operators never find. (The icon-only `railIconBtn` recipe stays for the
 * preference popups and sign-out, which are chrome rather than destinations.)
 * Opens the shared FeedbackDialog; the POST target is the workspace-gated
 * /api/feedback.
 */
export function NavFeedbackButton({ active }: { active: WorkspaceTabId }) {
  const t = useTranslations("feedback");
  const nav = useTranslations("nav");
  const [open, setOpen] = useState(false);
  // Two names on purpose: the rail is 4.75rem wide, so the visible label is the
  // short one ("Feedback") and the full verb rides in the tooltip — exactly how
  // the Search trigger next to it reads.
  const label = t("open");
  const railLabel = t("railLabel");
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        onPointerEnter={preloadFeedbackDialog}
        onFocus={preloadFeedbackDialog}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={label}
        className={railTile(false)}
      >
        <MessageSquarePlus size={20} aria-hidden />
        <span className="text-[13px] font-semibold leading-tight">{railLabel}</span>
      </button>
      {open ? <FeedbackDialog onClose={() => setOpen(false)} sourceLabel={navLabel(nav, `tabs.${active}`, active)} /> : null}
    </>
  );
}
