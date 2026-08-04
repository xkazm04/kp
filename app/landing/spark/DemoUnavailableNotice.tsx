"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

/*
 * Demo-CTA honesty: /api/demo redirects here with `?demo=unavailable` when a
 * gated deploy refuses to mint the public demo session (demoSessionAllowed()
 * false). Before this notice the hero's "Try the live demo" silently reloaded
 * the landing — a dead end with no explanation. Small fixed banner in the
 * landing's own art direction (app/landing is the literal-hex exemption);
 * dismissible, client-only (useSearchParams — mounted under Suspense in
 * SparkHome). Renders nothing without the param, so the landing pays nothing.
 */
export function DemoUnavailableNotice() {
  // The whole-"landing" namespace form (the sections' own convention): the
  // namespace union next-intl derives for this catalog doesn't accept the
  // nested "landing.demoNotice" path.
  const t = useTranslations("landing");
  const params = useSearchParams();
  const [dismissed, setDismissed] = useState(false);
  if (params.get("demo") !== "unavailable" || dismissed) return null;
  return (
    <div className="fixed inset-x-0 top-3 z-[70] flex justify-center px-4">
      <div
        role="status"
        className="flex max-w-xl items-start gap-3 rounded-xl border-2 border-[#141414] bg-[#fffdf6] px-4 py-3 shadow-[4px_4px_0_#141414]"
      >
        <div className="min-w-0 text-sm text-[#141414]">
          <p className="font-semibold">{t("demoNotice.title")}</p>
          <p className="mt-0.5 opacity-80">{t("demoNotice.body")}</p>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label={t("demoNotice.dismiss")}
          title={t("demoNotice.dismiss")}
          className="shrink-0 rounded-md p-1 text-[#141414] transition-colors hover:bg-[#141414]/10"
        >
          <X size={16} aria-hidden />
        </button>
      </div>
    </div>
  );
}
