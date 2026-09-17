"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { EYEBROW, NOTICE } from "@/app/_components/ui/recipes";
import { gateKey } from "./controlRoomConfirm";
import type { Gate, Guard } from "./types";

// The Art. 22 human gates waiting on this operator. Renders nothing when the queue
// is empty — the empty state that matters on this page is "automation is running".
export function GatesPanel({
  gates,
  armed,
  guard,
  onApprove,
}: {
  gates: Gate[];
  armed: string | null;
  guard: Guard;
  onApprove: (id: string) => void | Promise<void>;
}) {
  const t = useTranslations("control.gates");
  if (gates.length === 0) return null;

  return (
    <section className="mt-6">
      <h2 className={EYEBROW}>{t("heading", { count: gates.length })}</h2>
      <div className="mt-2 space-y-2">
        {gates.map((g) => {
          const key = gateKey(g.id, g.detail);
          return (
          <div key={g.id} className={`flex items-center gap-3 p-3 shadow-panel ${NOTICE("amber")}`}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">{g.title || t("untitled")}</span>
              {/* `detail` is the lifecycle's own server-composed descriptor — audit payload, not copy. */}
              <span className="block truncate text-micro text-steel">{g.detail}</span>
            </span>
            {/* Review is the edit path (DevLifecycleReviewPanel on Assignments).
                Approve stays the no-edit two-step confirm. */}
            <Link
              href={`/?tab=assignments&lifecycle=${encodeURIComponent(g.id)}`}
              className="focus-ring inline-flex h-8 shrink-0 items-center rounded-md border border-stone-200 bg-white px-3 text-sm font-semibold text-ink hover:border-coral/40"
            >
              {t("review")}
            </Link>
            {/* bug-ui-scan-2026-07-09 (guided-pipeline-simulation #3): approving an
                Art. 22 human gate is irreversible — require a deliberate confirm. */}
            <button
              type="button"
              onClick={() => guard(key, () => onApprove(g.id))}
              className={`focus-ring h-8 shrink-0 rounded-md px-3 text-sm font-semibold text-white hover:opacity-90 ${
                armed === key ? "bg-coral ring-2 ring-coral/40" : "bg-moss"
              }`}
            >
              {armed === key ? t("approveConfirm") : t("approve")}
            </button>
          </div>
          );
        })}
      </div>
    </section>
  );
}
