"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { BTN_GHOST, BTN_PRIMARY } from "@/app/_components/ui/recipes";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { copyText } from "@/app/_lib/export-utils";
import { useErrorMessage } from "@/app/_lib/use-error-message";

// A tokenized candidate link (voice screen, self-scheduling, …): the server mints a
// per-candidate URL on POST. Every flow shares the same busy/url/err/copied state quad
// and POST-then-store handler, so they live here once instead of being copy-pasted and
// edited in lockstep. The response always carries a relative `url`; flow-specific extras
// (e.g. the voice screen's `configured` flag) ride along on the same object and are read
// by the caller off `data`.
export type TokenLinkData = { url: string } & Record<string, unknown>;

export function useTokenLink(endpoint: string) {
  const t = useTranslations("pipeline");
  // Mint failures resolve from the machine `code`, never the server's English
  // `error` — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<TokenLinkData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const create = async (body: Record<string, unknown>) => {
    setBusy(true);
    setErr(null);
    setData(null);
    setCopied(false);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(errMsg(payload, t("tokenLink.createFailed")));
      setData(payload as TokenLinkData);
    } catch {
      setErr(t("tokenLink.createFailed"));
    } finally {
      setBusy(false);
    }
  };

  // Absolute URL for the copy/readonly field; the relative `data.url` stays for the
  // same-origin <a>. Resolved through publicBaseUrl (idea-e6c66bcd) so a candidate
  // pasted this link points at the deployment's public host, not the recruiter's
  // localhost/proxy origin — and matches the server-minted offer link exactly.
  // Origin is read lazily so SSR (no window) renders an empty field.
  const fullUrl = data ? publicBaseUrl(typeof window !== "undefined" ? window.location.origin : "") + data.url : "";

  // The check mark is a CLAIM ("this candidate's link is on your clipboard"), so it
  // only lands when the write actually took. `navigator.clipboard` is undefined in a
  // non-secure context — a self-hosted install served over plain http:// on a LAN is
  // exactly that — and the old `?.` swallowed the absence, flipped to ✓ and let the
  // recruiter paste whatever was on the clipboard before into the candidate's email.
  // copyText (export-utils) is the shared guard the saved-view share link already uses.
  const copy = async () => {
    if (await copyText(fullUrl)) setCopied(true);
  };

  return { busy, data, err, copied, create, copy, fullUrl };
}

// The shared link-display row: a readonly absolute-URL field, a copy button that flips
// to a check once clicked, and an open-as-candidate external link. Renders nothing until
// a link has been minted, so callers can drop it in unconditionally.
export function TokenLinkPanel({ link }: { link: ReturnType<typeof useTokenLink> }) {
  const t = useTranslations("pipeline");
  // "Open as candidate" walked straight into the LIVE capability link — the same
  // one-way door the candidate has. Several of these surfaces stamp an opened-at /
  // first-seen mark on first fetch (the schedule invite, the offer view, the
  // devcase session), so a recruiter checking "what does this look like?" burns the
  // candidate's own first-open and the timeline then reads as if they had looked.
  // One confirm, stated plainly, before the door opens. Copy stays one click — it
  // touches nothing.
  const [confirmOpen, setConfirmOpen] = useState(false);
  if (!link.data) return null;
  const url = link.data.url;
  return (
    <div className="flex items-center gap-1.5">
      <input
        readOnly
        value={link.fullUrl}
        onFocus={(e) => e.currentTarget.select()}
        className="focus-ring min-w-0 flex-1 rounded-md border border-stone-200 bg-paper px-2 py-1 text-sm text-ink"
      />
      <button
        type="button"
        title={t("tokenLink.copy")}
        onClick={() => void link.copy()}
        className="focus-ring rounded-md border border-stone-200 bg-white p-1.5 text-steel hover:text-coral"
      >
        {link.copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        className="focus-ring rounded-md border border-stone-200 bg-white p-1.5 text-steel hover:text-coral"
        title={t("tokenLink.openAsCandidate")}
      >
        <ExternalLink size={14} />
      </button>
      {confirmOpen ? (
        <Modal
          title={t("tokenLink.openConfirmTitle")}
          subtitle={t("tokenLink.openConfirmSubtitle")}
          size="md"
          onClose={() => setConfirmOpen(false)}
          footer={
            <>
              <button type="button" className={`${BTN_GHOST} px-3 py-1.5 text-sm`} onClick={() => setConfirmOpen(false)}>
                {t("tokenLink.openConfirmCancel")}
              </button>
              <button
                type="button"
                className={`${BTN_PRIMARY} px-3 py-1.5 text-sm`}
                onClick={() => {
                  setConfirmOpen(false);
                  window.open(url, "_blank", "noreferrer");
                }}
              >
                {t("tokenLink.openConfirmCta")}
              </button>
            </>
          }
        >
          <p className="text-base text-steel">{t("tokenLink.openConfirmBody")}</p>
        </Modal>
      ) : null}
    </div>
  );
}
