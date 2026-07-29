"use client";

import KandidateMark from "@/app/landing/_components/KandidateMark";
import { useBrand } from "@/app/_components/BrandProvider";

// Icon-only brand mark for the top of the two-level nav's icon rail (~4.75rem wide,
// no room for a name). Mirrors the interactive shell's railTop: the workspace's
// white-label logo when set, else the default KandiDate mark. A client island because
// the brand context (BrandProvider) is only reachable on the client — so the
// server-rendered deep-link sidebar can still show a configured logo.
export function RailBrandMark() {
  const { logoUrl } = useBrand();
  return (
    <div className="mb-1 hidden justify-center py-1 md:flex">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- external brand logo URL, not a bundled asset
        <img src={logoUrl} alt="" className="h-8 w-8 rounded-lg object-contain" />
      ) : (
        <KandidateMark className="h-8 w-8 text-ink [--k-accent:var(--color-coral)] [--k-fg:var(--color-paper)] dark:-rotate-3" />
      )}
    </div>
  );
}
