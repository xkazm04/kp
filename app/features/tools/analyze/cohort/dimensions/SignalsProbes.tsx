"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit";
import type { CohortMember } from "../cohortTypes";
import { CommentMark, MemberName } from "./dimensionParts";
import type { SignalKind } from "./signalsModel";

/** How long a copy button says "Copied" before it reads "Copy" again. */
const COPIED_MS = 1800;

/**
 * The focused member's suggested interview probes, each ready to copy into an interview plan,
 * and all of them at once (one line per probe, prefixed with the signal it tests).
 */
export function SignalsProbes({ member, probes, comment, onOpenReport }: {
  member: CohortMember | undefined;
  comment: string | undefined;
  probes: Array<{ label: string; kind: SignalKind; probe: string }>;
  onOpenReport: (slug: string) => void;
}) {
  const t = useTranslations("analyzeCohort.pages.signals");
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const copy = (id: string, text: string) => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(id);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(null), COPIED_MS);
      })
      .catch(() => {
        /* the clipboard was refused (no permission, insecure origin): the probe stays on screen to select by hand */
      });
  };

  if (!member) {
    return (
      <aside className="cd-focus" aria-live="polite">
        <p className="cd-focus__prompt">{t("focusPrompt")}</p>
      </aside>
    );
  }
  const all = probes.map((p) => `${p.label}: ${p.probe}`).join("\n");
  return (
    <aside className="cd-focus" aria-live="polite" aria-label={t("probes", { name: member.label })}>
      <p className="cd-focus__kicker">{t("probesKicker")}</p>
      <h3 className="cd-focus__name">
        <MemberName member={member} onOpenReport={onOpenReport} />
        <CommentMark name={member.label} text={comment} />
      </h3>
      {probes.length ? (
        <>
          <ol className="cd-probes">
            {probes.map((p, i) => {
              const id = `${i}`;
              return (
                <li key={id} className="cd-probe" data-kind={p.kind}>
                  <span className="cd-probe__for">{p.label}</span>
                  <q className="cd-probe__q">{p.probe}</q>
                  <Button size="sm" variant="ghost" icon={copied === id ? "check" : "copy"} label={copied === id ? t("copied") : t("copy")} onClick={() => copy(id, p.probe)} />
                </li>
              );
            })}
          </ol>
          <Button size="sm" variant="secondary" icon={copied === "all" ? "check" : "copy"} label={copied === "all" ? t("copied") : t("copyAll", { n: probes.length })} onClick={() => copy("all", all)} />
        </>
      ) : (
        <p className="cd-focus__quiet">{t("probesNone")}</p>
      )}
    </aside>
  );
}
