"use client";

import { useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { railTile } from "@/app/_components/ui/recipes";
import { FeedbackDialog } from "./FeedbackDialog";

/*
 * The rail's "Send feedback" affordance, in the SAME icon-over-label shape as the
 * rail's Search trigger and the section buttons above it — the rail is the
 * wayfinding surface, and a door that only appears on hover is a door most
 * operators never find. (The icon-only `railIconBtn` recipe stays for the
 * preference popups and sign-out, which are chrome rather than destinations.)
 * Opens the shared FeedbackDialog; the POST target is the workspace-gated
 * /api/feedback.
 */
export function NavFeedbackButton() {
  const t = useTranslations("feedback");
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
        aria-haspopup="dialog"
        aria-expanded={open}
        title={label}
        className={railTile(false)}
      >
        <MessageSquarePlus size={20} aria-hidden />
        <span className="text-[13px] font-semibold leading-tight">{railLabel}</span>
      </button>
      {open ? <FeedbackDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}
