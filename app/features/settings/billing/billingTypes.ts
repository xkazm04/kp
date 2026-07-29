import type { BadgeTone } from "@/app/_components/Badge";
import type { BillingOverview, PlanDef } from "@/app/_lib/billing";

// Shared billing types — split out of BillingTab.tsx so BillingPlanCatalog and
// the other split-out billing components can import them without pulling in
// the tab's full render tree.

// Shape of GET /api/billing: the entitlements overview plus the static catalog
// and whether the payment provider is wired (false = unbilled local dev).
// PackDef isn't part of the billing module's public surface (index.ts), so the
// pack's wire shape is mirrored here type-only.
export type PackInfo = { id: string; name: string; meter: string; qty: number; priceCzk: number; priceUsdApprox: number };
export type BillingPayload = BillingOverview & {
  configured: boolean;
  catalog: { plans: Record<string, PlanDef>; packs: { minutes_100?: PackInfo } };
};

// Subscription lifecycle -> badge tone. Unknown statuses (provider drift) fall
// back to neutral with the raw value labelized, never silently masked.
export const STATUS_TONE: Record<string, BadgeTone> = {
  active: "positive",
  trialing: "info",
  past_due: "caution",
  canceled: "critical",
  none: "neutral",
};
