// Payment gate (docs/BILLING.md) — public surface of the billing module.
// Provider-agnostic by construction: routes and product code import from here
// and gateway.ts only; polar.ts is an implementation detail behind
// polarGatewayFromEnv().

export { BillingConfigError } from "./gateway";
export type { BillingEvent, BillingGateway, Checkout, CheckoutRequest, ProductMap } from "./gateway";
export {
  billingOverview,
  entitledPlan,
  hasActiveSubscription,
  meterAllowance,
  recordMeterUsage,
  type Allowance,
  type BillingOverview,
  type MeterOverview,
} from "./entitlements";
export { activeJobsGate, meterAllows, meterGate, QUOTA_CODE, type QuotaVerdict } from "./enforce";
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
export { polarGatewayFromEnv } from "./polar";
export { reduceBillingEvent, type BillingAction } from "./reduce";
export { applyBillingAction, ingestBillingWebhook, type IngestResult } from "./sync";
