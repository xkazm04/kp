"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { publicBaseUrl } from "@/app/_lib/public-base-url";

// The OUT side of the distribution seam: the apply token is the artifact you
// hand to candidates/channels. Render it as a tappable pill that copies the full
// apply URL and confirms with a moss check for ~1.5s.
export function ApplyTokenPill({ token }: { token: string | null }) {
  const t = useTranslations("devcase.studio.applyPill");
  const [copied, setCopied] = useState(false);
  // `navigator.clipboard` is undefined on an insecure origin and rejects when the
  // permission is denied — both routine for a self-hosted install reached over plain
  // http on a LAN address. The catch used to be a no-op, so the pill answered a click
  // with nothing at all and the ONE artifact this panel exists to hand out was
  // unreachable: the URL was never rendered, only copied, so there was nothing to
  // select by hand either. On failure we now show it as selectable text.
  const [blocked, setBlocked] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (!token) {
    return <span className="font-mono text-micro text-steel">{t("noToken")}</span>;
  }

  // Candidate-facing apply link — resolved through publicBaseUrl (idea-e6c66bcd)
  // so the shared artifact carries the deployment's public host, not the
  // recruiter's localhost/proxy origin. Empty base (SSR) keeps it relative.
  // W5-1: points at the human-facing apply PAGE (brief + starter files +
  // submission form), not the raw POST-only inbound webhook a browser 405s on;
  // the page submits through that same webhook.
  const applyUrl = `${publicBaseUrl(typeof window !== "undefined" ? window.location.origin : "")}/devcase/apply/${token}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(applyUrl);
      setBlocked(false);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Not silent: the clipboard is genuinely unavailable (insecure context or
      // denied permission) and the operator can still complete the task by hand,
      // so say so and put the URL where it can be selected.
      setCopied(false);
      setBlocked(true);
    }
  };

  if (blocked) {
    return (
      <span className="flex min-w-0 flex-col gap-0.5">
        <span role="status" className="text-micro text-amber-700">
          {t("blocked")}
        </span>
        {/* select-all so one click grabs the whole URL; `break-all` because an apply
            link is a single unbreakable word and would otherwise blow out the card. */}
        <span className="select-all break-all font-mono text-micro text-ink">{applyUrl}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={t("copy")}
      aria-label={copied ? t("copiedAria") : t("copyAria")}
      className="focus-ring inline-flex min-w-0 items-center gap-1.5 rounded-full border border-stone-200 bg-paper px-2 py-0.5 text-micro font-medium text-steel transition-colors hover:border-coral/40 hover:text-ink"
    >
      {copied ? (
        <Check size={11} className="shrink-0 text-moss" aria-hidden />
      ) : (
        <Copy size={11} className="shrink-0" aria-hidden />
      )}
      <span className="truncate font-mono">{copied ? t("copied") : t("token", { token })}</span>
    </button>
  );
}
