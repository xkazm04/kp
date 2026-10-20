"use client";

import type { ReactNode } from "react";
import { track } from "@/app/_lib/analytics/plausible";

/*
 * A plain link that reports its click as a landing CTA (placement, optional
 * plan), then navigates as any link does. The landing's non-start calls to
 * action use it: "Run it yourself" in the hero, "Get the source" on the
 * self-hosted card, "Talk to sales". Fire-and-forget: tracking never blocks the
 * navigation (see app/_lib/analytics/track.ts).
 */
export function TrackedLink({
  href,
  placement,
  plan,
  external = false,
  className,
  children
}: {
  href: string;
  placement: string;
  plan?: string;
  /** Opens in a new tab (the repository). */
  external?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      className={className}
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      onClick={() => track("landing_cta_click", plan ? { placement, plan } : { placement })}
    >
      {children}
    </a>
  );
}
