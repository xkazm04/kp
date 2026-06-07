"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";

// A tokenized candidate link (voice screen, self-scheduling, …): the server mints a
// per-candidate URL on POST. Every flow shares the same busy/url/err/copied state quad
// and POST-then-store handler, so they live here once instead of being copy-pasted and
// edited in lockstep. The response always carries a relative `url`; flow-specific extras
// (e.g. the voice screen's `configured` flag) ride along on the same object and are read
// by the caller off `data`.
export type TokenLinkData = { url: string } & Record<string, unknown>;

export function useTokenLink(endpoint: string) {
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
      if (!res.ok) throw new Error(payload.error || `link failed (${res.status})`);
      setData(payload as TokenLinkData);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't create the link.");
    } finally {
      setBusy(false);
    }
  };

  // Absolute URL for the copy/readonly field; the relative `data.url` stays for the
  // same-origin <a>. Origin is read lazily so SSR (no window) renders an empty field.
  const fullUrl = data ? (typeof window !== "undefined" ? window.location.origin : "") + data.url : "";

  const copy = () => {
    void navigator.clipboard?.writeText(fullUrl);
    setCopied(true);
  };

  return { busy, data, err, copied, create, copy, fullUrl };
}

// The shared link-display row: a readonly absolute-URL field, a copy button that flips
// to a check once clicked, and an open-as-candidate external link. Renders nothing until
// a link has been minted, so callers can drop it in unconditionally.
export function TokenLinkPanel({ link }: { link: ReturnType<typeof useTokenLink> }) {
  if (!link.data) return null;
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
        title="Copy link"
        onClick={link.copy}
        className="focus-ring rounded-md border border-stone-200 bg-white p-1.5 text-steel hover:text-coral"
      >
        {link.copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <a
        href={link.data.url}
        target="_blank"
        rel="noreferrer"
        className="focus-ring rounded-md border border-stone-200 bg-white p-1.5 text-steel hover:text-coral"
        title="Open as candidate"
      >
        <ExternalLink size={14} />
      </a>
    </div>
  );
}
