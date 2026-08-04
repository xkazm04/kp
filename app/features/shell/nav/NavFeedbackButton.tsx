"use client";

import { useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { railIconBtn } from "@/app/_components/ui/recipes";
import { FeedbackDialog } from "./FeedbackDialog";

/*
 * The rail's "Send feedback" affordance — an icon-only control on the shared
 * rail-control recipe, sitting with the appearance/language preferences and
 * sign-out in the sidebar's bottom slot (the SignOutButton pattern: name in
 * aria-label + sr-only + tooltip, never visible chrome). Opens the shared
 * FeedbackDialog; the POST target is the workspace-gated /api/feedback.
 */
export function NavFeedbackButton() {
  const t = useTranslations("feedback");
  const [open, setOpen] = useState(false);
  const label = t("open");
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={label} title={label} className={railIconBtn(open)}>
        <MessageSquarePlus className="h-[18px] w-[18px] shrink-0" aria-hidden />
        <span className="sr-only">{label}</span>
      </button>
      {open ? <FeedbackDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}
