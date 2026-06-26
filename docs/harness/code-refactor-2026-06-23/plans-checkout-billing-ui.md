> Total: 6 findings (0c critical, 1h high, 3m medium, 2l low)

## 1. Triplicated CZK/USD price-rendering block in BillingTab
- **Severity**: High
- **Category**: duplication
- **File**: app/features/sub_billing/BillingTab.tsx:118-130, 323-340, 413-431
- **Scenario**: The exact same "priceFree-or-CZK-currency · approxUsd · perMonth" rendering pattern is hand-written three times. Confirmed by grep: `style: "currency"` appears at lines 121, 126, 326, 332, 417, 425; `approxUsd` at 125, 330, 423; `priceFree` at 120, 325. PlanCard (118-130), the current-plan card (323-340), and the minutes-pack block (413-431) each re-spell `format.number(..., { style: "currency", currency: "CZK", maximumFractionDigits: 0 })` plus the USD approx label.
- **Root cause**: No shared price-formatting subcomponent/helper; each card was authored independently. Note: the existing `formatCzk` in `@/app/_lib/format` is NOT a drop-in — it emits grouped integers with no symbol and a fixed LOCALE, whereas this UI wants the locale-reactive `useFormatter().number({style:"currency"})` with the symbol. So reuse must be a new local helper, not formatCzk.
- **Impact**: Any pricing-display tweak (fraction digits, currency, USD label wording) must be edited in 3 places; drift risk. Payment-adjacent display only — no entitlement/price *logic* involved, purely formatting.
- **Fix sketch**: Extract a small presentational helper inside BillingTab, e.g. `function PriceLine({ czk, usd }: { czk: number; usd: number })` that renders the free/CZK + approxUsd + perMonth markup once, and call it from all three sites. Keep the numeric values (priceCzk/priceUsdApprox) untouched.

## 2. Stale/incorrect comment: PackId IS on the public surface
- **Severity**: Medium
- **Category**: cleanup
- **File**: app/features/sub_billing/BillingTab.tsx:21-23
- **Scenario**: The comment claims "PackDef isn't part of the billing module's public surface (index.ts), so the pack's wire shape is mirrored here type-only." Grep of `app/_lib/billing/index.ts` shows `PackId` and `isPackId`, `PACKS`, `PlanDef` ARE all exported; only the `PackDef` *type* name is omitted. The local `PackInfo` (line 23) is a hand-mirrored copy of `PackDef`'s fields (id, name, meter, qty, priceCzk, priceUsdApprox), loosened to `string` for id/meter.
- **Root cause**: index.ts was later extended to export `type PackId` (and re-export PACKS/PlanDef) but the comment + local mirror were never revisited.
- **Impact**: Misleading comment; `PackInfo` can silently diverge from `PackDef` if the catalog wire shape changes (a field added to PackDef won't appear here and won't error). Low blast radius (display only).
- **Fix sketch**: Either (a) export `type PackDef` from index.ts and replace `PackInfo` with `PackDef` in the `BillingPayload` type, or (b) keep the local type but correct the comment to "PackDef type isn't re-exported; mirrored here." Do NOT change the runtime shape. Prefer (a) — removes the duplicate type entirely.

## 3. BillingPayload.catalog.plans widened to Record<string, PlanDef>
- **Severity**: Medium
- **Category**: structure
- **File**: app/features/sub_billing/BillingTab.tsx:26
- **Scenario**: `BillingTab` redeclares the GET /api/billing payload locally and types the catalog as `{ plans: Record<string, PlanDef>; packs: { minutes_100?: PackInfo } }`. The server (`app/api/billing/route.ts:17`) returns `PLANS`, whose source type is `Record<PlanId, PlanDef>` (plans.ts:28). The client throws away the `PlanId` key narrowing for `string`.
- **Root cause**: The route does not export a shared response type, so the client re-types the payload by hand and loosened the key type.
- **Impact**: Minor type-safety loss — `data.catalog.plans` indexing isn't key-checked against PlanId; a typo'd plan key wouldn't be caught. No runtime effect (UI iterates `Object.values`). Mostly a structural/consistency nit.
- **Fix sketch**: Either narrow to `Record<PlanId, PlanDef>` (import the already-exported `PlanId`), or have the route export its response type and import it. Don't over-engineer; narrowing the one field is enough.

## 4. PackInfo declares id/name/meter that the UI never renders
- **Severity**: Low
- **Category**: dead-code
- **File**: app/features/sub_billing/BillingTab.tsx:23
- **Scenario**: `PackInfo` declares `id, name, meter, qty, priceCzk, priceUsdApprox`. Grep of the pack render block shows only `data.catalog.packs.minutes_100.{qty,priceCzk,priceUsdApprox}` are read (lines 414, 416, 424); `id`, `name`, `meter` are present on the wire but never displayed in this tab.
- **Root cause**: The type mirrors the full `PackDef` even though the pack card uses hard-coded i18n strings (`t("pack.title")`, `t("pack.minutes")`) instead of the wire `name`/`meter`.
- **Impact**: Harmless unused type fields; only matters as a documentation/clarity nit. Ties into finding 2 (if PackDef is reused, this self-resolves).
- **Fix sketch**: No action required if finding 2 is adopted (reuse PackDef). Otherwise optionally trim PackInfo to the three rendered fields. Leave the wire payload unchanged.

## 5. Inverted duplicate guards on the meter progress bar
- **Severity**: Low
- **Category**: cleanup
- **File**: app/features/sub_billing/BillingTab.tsx:46-77
- **Scenario**: `pct` is computed with the branch `limit === null || limit === 0 ? (used>0?100:0) : ...` (lines 46-51), but the progress bar is only rendered when `limit === null || limit <= 0 ? null : (<bar>)` (line 64) — i.e. the `limit === 0` / `null` cases that `pct` carefully handles can never reach the bar that consumes `pct`. The `used>0?100:0` branch of `pct` is effectively dead for rendering purposes.
- **Root cause**: Defensive computation left in after the render guard at line 64 was added (per the inline a11y comment about aria-valuemax). The two pieces overlap.
- **Impact**: No bug — just redundant logic that reads as if the 0/null case produces a bar when it never does. Mild confusion for the next editor.
- **Fix sketch**: Simplify `pct` to the `limit` numeric case only (it's only used inside the `limit > 0` branch), or add a one-line comment that the 0/null arms of `pct` are unreachable by the bar. Cosmetic; verify the bar still only renders for `limit > 0`.

## 6. EVENTS list in polar-setup.mjs duplicates the webhook-handler's event set
- **Severity**: Medium
- **Category**: duplication
- **File**: scripts/polar-setup.mjs:22
- **Scenario**: `const EVENTS = ["subscription.created", "subscription.updated", "order.paid"]` is the set of events subscribed when creating the Polar webhook endpoint. The actual handler/reducer lives in `app/_lib/billing/reduce.ts` + `sync.ts` (the webhook ingest path). These two lists must stay in lockstep — if the reducer starts handling a new event, the setup script silently won't subscribe to it (and vice-versa, a subscribed event with no handler).
- **Root cause**: The event taxonomy is declared independently in the setup script and the runtime reducer; no single source of truth.
- **Impact**: Cross-file drift risk on a payment-critical path: a handled-but-unsubscribed event = missed entitlement updates. Not currently broken (the 3 listed match the documented set), but it's a duplication trap. This is config plumbing, not entitlement/price logic.
- **Fix sketch**: Export the canonical event-name list from the billing module (e.g. alongside `reduceBillingEvent`) and import it in polar-setup.mjs, or at minimum add a cross-reference comment in both files. Don't change which events are handled.
