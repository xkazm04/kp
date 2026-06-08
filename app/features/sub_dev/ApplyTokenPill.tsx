"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { publicBaseUrl } from "@/app/_lib/public-base-url";

// The OUT side of the distribution seam: the apply token is the artifact you
// hand to candidates/channels. Render it as a tappable pill that copies the full
// apply URL and confirms with a moss check for ~1.5s.
export function ApplyTokenPill({ token }: { token: string | null }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (!token) {
    return <span className="font-mono text-micro text-steel">no token</span>;
  }

  // Candidate-facing apply link — resolved through publicBaseUrl (idea-e6c66bcd)
  // so the shared artifact carries the deployment's public host, not the
  // recruiter's localhost/proxy origin. Empty base (SSR) keeps it relative.
  const applyUrl = `${publicBaseUrl(typeof window !== "undefined" ? window.location.origin : "")}/api/devcase/inbound?token=${token}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(applyUrl);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (insecure context / denied) — no-op */
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      title="Copy the apply link to share with candidates"
      aria-label={copied ? "Apply link copied to clipboard" : "Copy apply link to clipboard"}
      className="focus-ring inline-flex min-w-0 items-center gap-1.5 rounded-full border border-stone-200 bg-paper px-2 py-0.5 text-micro font-medium text-steel transition-colors hover:border-coral/40 hover:text-ink"
    >
      {copied ? (
        <Check size={11} className="shrink-0 text-moss" aria-hidden />
      ) : (
        <Copy size={11} className="shrink-0" aria-hidden />
      )}
      <span className="truncate font-mono">{copied ? "Copied!" : `token ${token}`}</span>
    </button>
  );
}
