// Headless Polar setup (docs/features/billing/README.md) — idempotent; safe to re-run.
//
//   npm run polar:setup -- --tunnel https://<your>.trycloudflare.com
//
// (Run via the npm script, NOT `node scripts/polar-setup.mjs` directly — it imports
// the TS catalog so the displayed prices and the reconciliation below share ONE
// source of truth, which needs the transform loader the npm script wires in.)
//
// Reads POLAR_ACCESS_TOKEN + POLAR_SERVER from .env, then:
//   1. validates the token (with an environment-mismatch hint on 401),
//   2. verifies the POLAR_PRODUCT_* ids exist AND reconciles each product's live
//      prices against the catalog (plans-checkout-billing-ui #4), warning loudly on
//      drift; creates the missing one-time pack (price derived from the catalog) and
//      writes its id back to .env,
//   3. ensures ONE webhook endpoint for <tunnel>/api/billing/webhook:
//      creates it (events: subscription.created/updated, order.paid) and
//      writes POLAR_WEBHOOK_SECRET to .env — or, when an endpoint for
//      /api/billing/webhook already exists, just PATCHes its URL to the new
//      tunnel so the SECRET STAYS STABLE across dev sessions.
//
// No secrets are printed. Restart the dev server after .env changes.

import fs from "node:fs";
import path from "node:path";
// plans-checkout-billing-ui #4: derive prices + the drift preflight from the catalog
// so the UI-displayed price and the amount charged can never silently diverge.
import { PLANS, PACKS } from "@/app/_lib/billing/plans.ts";
import { reconcileCatalogPrice, readProviderPrices, packUsdCents } from "@/app/_lib/billing/price-reconcile.ts";

const ENV_PATH = path.join(process.cwd(), ".env");
const WEBHOOK_PATH = "/api/billing/webhook";
const EVENTS = ["subscription.created", "subscription.updated", "order.paid"];
// Name + USD price DERIVED from the catalog (single source of truth) — no more
// hardcoded 3400 that could drift from plans.ts (plans-checkout-billing-ui #4).
const PACK = { name: PACKS.minutes_100.name, priceUsdCents: packUsdCents() };

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--tunnel") args.tunnel = argv[++i];
  }
  return args;
}

function readEnv() {
  if (!fs.existsSync(ENV_PATH)) fail(`.env not found at ${ENV_PATH}`);
  const lines = fs.readFileSync(ENV_PATH, "utf-8").split(/\r?\n/);
  const get = (key) => {
    const line = lines.find((l) => l.startsWith(`${key}=`));
    const value = line ? line.slice(key.length + 1).trim() : "";
    return value || null;
  };
  return { lines, get };
}

/** Set KEY=value in .env: replace the existing line or append. Preserves
 *  everything else byte-for-byte. */
function writeEnvKey(key, value) {
  const raw = fs.readFileSync(ENV_PATH, "utf-8");
  const lines = raw.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (idx >= 0) lines[idx] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  fs.writeFileSync(ENV_PATH, lines.join("\n"), "utf-8");
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const { tunnel } = parseArgs(process.argv);
const env = readEnv();
const token = env.get("POLAR_ACCESS_TOKEN");
const server = env.get("POLAR_SERVER") === "production" ? "production" : "sandbox";
const base = server === "production" ? "https://api.polar.sh" : "https://sandbox-api.polar.sh";
if (!token) fail("POLAR_ACCESS_TOKEN is not set in .env");

async function polar(method, apiPath, body) {
  const res = await fetch(`${base}${apiPath}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (res.status === 401) {
    fail(
      `Polar ${server} rejected the token (401). Tokens are environment-specific and shown once: ` +
        `create a fresh Organization Access Token at ${server === "sandbox" ? "sandbox.polar.sh" : "polar.sh"} ` +
        `(Settings → Developers → New token), paste it into .env as POLAR_ACCESS_TOKEN, and re-run.`
    );
  }
  if (!res.ok) fail(`Polar ${method} ${apiPath} failed (${res.status}): ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

async function listAll(apiPath) {
  const items = [];
  for (let page = 1; page < 20; page++) {
    const data = await polar("GET", `${apiPath}?limit=100&page=${page}`);
    items.push(...(data.items ?? []));
    if (!data.pagination || items.length >= (data.pagination.total_count ?? 0)) break;
  }
  return items;
}

// ---- 1. token + products -----------------------------------------------------

const products = await listAll("/v1/products");
console.log(`✓ token ok — ${server} org has ${products.length} product(s)`);

/** Reconcile a product's live prices against the catalog and print the verdict
 *  (plans-checkout-billing-ui #4). CZK is the primary displayed price → a mismatch
 *  is a loud ✗; USD is approximate → a tolerance band; a missing CZK price (e.g. a
 *  USD-only product while the UI shows a Kč primary) is a ! note. Best-effort: an
 *  unrecognized price shape yields "no comparable price" rather than a false alarm. */
function reportPriceDrift(label, catalog, product) {
  const drift = reconcileCatalogPrice(label, catalog, readProviderPrices(product));
  if (drift.length === 0) {
    console.log(`  ✓ ${label} price matches the catalog`);
    return;
  }
  for (const d of drift) {
    if (d.level === "error") console.error(`  ✗ price drift — ${d.message}`);
    else console.warn(`  ! price note — ${d.message}`);
  }
}

const productKeys = [
  ["POLAR_PRODUCT_STARTER", "Starter (subscription)", "starter"],
  ["POLAR_PRODUCT_GROWTH", "Growth (subscription)", "growth"],
  ["POLAR_PRODUCT_BYOM", "BYOM (subscription)", "byom"],
];
for (const [key, label, planId] of productKeys) {
  const id = env.get(key);
  if (!id) {
    console.warn(`! ${key} is empty — create the ${label} product and fill it in`);
    continue;
  }
  const product = products.find((p) => p.id === id);
  if (!product) {
    console.warn(`! ${key}=${id} not found in this ${server} org — wrong id or wrong org?`);
    continue;
  }
  console.log(`✓ ${key} ok`);
  reportPriceDrift(label, PLANS[planId], product);
}

let packId = env.get("POLAR_PRODUCT_MINUTE_PACK");
let packProduct = packId ? products.find((p) => p.id === packId) : null;
if (packProduct) {
  console.log("✓ POLAR_PRODUCT_MINUTE_PACK ok");
} else {
  const existing = products.find((p) => !p.is_recurring && p.name === PACK.name && !p.is_archived);
  packProduct =
    existing ??
    (await polar("POST", "/v1/products", {
      name: PACK.name,
      recurring_interval: null,
      // USD-only, price derived from the catalog. The catalog's PRIMARY display price is
      // CZK (790 Kč); provisioning a matching CZK price is deferred (needs Polar
      // multi-currency verification) — the reconcile note below surfaces the gap loudly
      // instead of leaving it silent (plans-checkout-billing-ui #4).
      prices: [{ amount_type: "fixed", price_currency: "usd", price_amount: PACK.priceUsdCents }],
    }));
  packId = packProduct.id;
  writeEnvKey("POLAR_PRODUCT_MINUTE_PACK", packId);
  console.log(`✓ minute pack ${existing ? "found" : "created"} → POLAR_PRODUCT_MINUTE_PACK=${packId}`);
}
if (packProduct) reportPriceDrift("Minute pack", PACKS.minutes_100, packProduct);

// ---- 2. webhook endpoint -------------------------------------------------------

if (!tunnel) {
  console.log("– no --tunnel given; skipping webhook endpoint setup");
} else {
  const url = `${tunnel.replace(/\/$/, "")}${WEBHOOK_PATH}`;
  const endpoints = await listAll("/v1/webhooks/endpoints");
  const ours = endpoints.find((e) => typeof e.url === "string" && e.url.endsWith(WEBHOOK_PATH));
  if (ours) {
    if (ours.url === url) {
      console.log(`✓ webhook endpoint already points at ${url}`);
    } else {
      await polar("PATCH", `/v1/webhooks/endpoints/${ours.id}`, { url });
      console.log(`✓ webhook endpoint URL updated → ${url} (secret unchanged)`);
    }
    if (!env.get("POLAR_WEBHOOK_SECRET")) {
      console.warn(
        "! POLAR_WEBHOOK_SECRET is empty but the endpoint already exists — its secret is shown only at " +
          "creation. Delete the endpoint in the dashboard and re-run, or copy the secret from where you saved it."
      );
    }
  } else {
    const created = await polar("POST", "/v1/webhooks/endpoints", {
      url,
      format: "raw",
      events: EVENTS,
      name: "kp billing (local dev)",
    });
    if (!created.secret) fail("endpoint created but no secret in the response — check the dashboard");
    writeEnvKey("POLAR_WEBHOOK_SECRET", created.secret);
    console.log(`✓ webhook endpoint created (${created.id}) for ${url}`);
    console.log(`✓ POLAR_WEBHOOK_SECRET written to .env (${created.secret.length} chars, not shown)`);
    console.log(`  events: ${EVENTS.join(", ")}`);
  }
  console.log("→ restart the dev server so it reloads .env, then test a checkout.");
}
