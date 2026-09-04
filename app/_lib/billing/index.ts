// Payment gate (docs/features/billing/README.md) — public surface of the billing module.
// Provider-agnostic by construction: routes and product code import from here
// and gateway.ts only; polar.ts is an implementation detail behind
// polarGatewayFromEnv().

export { BillingConfigError } from "./gateway";
export type { BillingEvent, BillingGateway, Checkout, CheckoutRequest, ProductMap } from "./gateway";
export {
  billingOrgForWorkspace,
  billingOverview,
  entitledPlan,
  hasActiveSubscription,
  meterAllowance,
  meteringActive,
  recordMeterUsage,
  type Allowance,
  type BillingOverview,
  type MeterOverview,
} from "./entitlements";
export { jobPostGate, meterAllows, meterGate, QUOTA_CODE, type QuotaVerdict } from "./enforce";
export {
  currentPeriod,
  isPackId,
  isPlanId,
  isSelfServePlan,
  METERS,
  PACKS,
  PLAN_IDS,
  PLANS,
  type Meter,
  type PackId,
  type PlanDef,
  type PlanId,
} from "./plans";
export { billingProviderConfigured } from "./mode";
// The timeout error IS part of the provider-agnostic surface even though polar.ts is
// an implementation detail: a route has to tell "the provider ran out of time" from
// "the provider said no", and that distinction is not Polar-specific.
export { BillingProviderTimeoutError, polarGatewayFromEnv } from "./polar";
export { reduceBillingEvent, type BillingAction } from "./reduce";
export { applyBillingAction, ingestBillingWebhook, resolveBillingOrg, type IngestResult } from "./sync";
