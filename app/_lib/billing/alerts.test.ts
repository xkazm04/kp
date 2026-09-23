// billing_alerts gets its reader (challenge-r05 billing-plan-and-spend/A).
//
// The table was WRITE-ONLY: sync.ts records a paid-but-unmapped subscription
// (`unmapped_product`, attributed to the paying org) and the daily reconcile records
// catalog-vs-provider `price_drift` (deployment-level, stored under the default org),
// and nothing read either back. These cases pin the reader's three halves:
//
//   - the STORE: an org-filtered list beside the deployment-wide one (tenancy doctrine
//     unchanged — the cross-customer list stays the operator's);
//   - the PROJECTION: a closed kind vocabulary, an audience per kind, and the raw
//     provider `detail` withheld from everyone but the home-org operator;
//   - the FORWARD-COMPAT rule: a kind written by a newer writer is shown as `unknown`,
//     never silently dropped.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { listBillingAlertsForOrg, recordBillingAlert, resolveBillingAlert, type BillingAlert } from "../db/billing.ts";
import {
  BILLING_ALERT_KINDS,
  billingAlertViews,
  isBillingAlertKind,
  isBillingAlertResolution,
} from "./alerts.ts";

after(() => cleanupUnitDb());

const DEFAULT_ORG = "org-default";
const ORG_B = "org-b-alerts";

function row(over: Partial<BillingAlert>): BillingAlert {
  return {
    id: 1,
    orgId: ORG_B,
    kind: "unmapped_product",
    detail: "product prod_123 not in POLAR_PRODUCT_*",
    providerRef: "sub_123",
    createdAt: "2026-09-20T10:00:00.000Z",
    resolvedAt: null,
    resolution: null,
    ...over,
  };
}

test("store: an org owner's list holds exactly that org's OPEN alerts", () => {
  assert.ok(recordBillingAlert({ kind: "price_drift", detail: "starter: catalog 490 CZK, provider 520 CZK", providerRef: "prod_starter" }));
  assert.ok(recordBillingAlert({ orgId: DEFAULT_ORG, kind: "unmapped_product", detail: "product prod_old not mapped", providerRef: "sub_default_dark" }));
  assert.ok(recordBillingAlert({ orgId: ORG_B, kind: "unmapped_product", detail: "product prod_123 not mapped", providerRef: "sub_b_dark" }));

  const b = listBillingAlertsForOrg(ORG_B);
  assert.equal(b.length, 1, "org-b sees its own row and nothing of the default org's");
  assert.equal(b[0].orgId, ORG_B);
  assert.equal(b[0].kind, "unmapped_product");
  assert.equal(b[0].resolution, null);

  const def = listBillingAlertsForOrg(DEFAULT_ORG);
  assert.deepEqual(def.map((a) => a.kind).sort(), ["price_drift", "unmapped_product"]);

  // A resolved row leaves the open list, and comes back only when asked for.
  assert.ok(resolveBillingAlert({ id: b[0].id, orgId: ORG_B, resolution: "dismissed" }));
  assert.equal(listBillingAlertsForOrg(ORG_B).length, 0);
  const all = listBillingAlertsForOrg(ORG_B, { includeResolved: true });
  assert.equal(all.length, 1);
  assert.equal(all[0].resolution, "dismissed", "HOW it ended is kept — a fix and noise are different outcomes");
  assert.ok(all[0].resolvedAt);
});

test("projection: an org owner reads a code, never the provider detail", () => {
  const views = billingAlertViews([row({})], { homeOrgReader: false });
  assert.equal(views.length, 1);
  assert.equal(views[0].code, "unmapped_product");
  assert.equal(views[0].audience, "customer");
  assert.equal("detail" in views[0], false, "the POLAR_PRODUCT_* detail is operator information");

  const operator = billingAlertViews([row({})], { homeOrgReader: true });
  assert.equal(operator[0].detail, "product prod_123 not in POLAR_PRODUCT_*");
});

test("audience: deployment-level price_drift reaches the home-org operator only", () => {
  const drift = row({ id: 2, orgId: DEFAULT_ORG, kind: "price_drift", detail: "growth drift", providerRef: "prod_growth" });
  const owner = billingAlertViews([drift, row({ id: 3 })], { homeOrgReader: false });
  assert.equal(owner.filter((v) => v.code === "price_drift").length, 0, "an owner of another org sees zero price_drift");
  assert.equal(owner.length, 1);

  const operator = billingAlertViews([drift], { homeOrgReader: true });
  assert.equal(operator.length, 1);
  assert.equal(operator[0].code, "price_drift");
  assert.equal(operator[0].audience, "operator");
  assert.equal(operator[0].detail, "growth drift");
});

test("closed vocabulary: a newer writer's kind shows as unknown, never dropped", () => {
  const views = billingAlertViews([row({ id: 9, kind: "future_kind" })], { homeOrgReader: false });
  assert.equal(views.length, 1, "a kind this reader does not know is still an alert somebody must see");
  assert.equal(views[0].code, "unknown");
  assert.equal(views[0].id, 9);
  assert.equal("detail" in views[0], false);

  assert.deepEqual([...BILLING_ALERT_KINDS], ["unmapped_product", "price_drift"]);
  assert.equal(isBillingAlertKind("unmapped_product"), true);
  assert.equal(isBillingAlertKind("x"), false);
  assert.equal(isBillingAlertResolution("fixed"), true);
  assert.equal(isBillingAlertResolution("dismissed"), true);
  assert.equal(isBillingAlertResolution("bogus"), false);
});
