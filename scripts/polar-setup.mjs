// Headless Polar setup (docs/BILLING.md) — idempotent; safe to re-run.
//
//   node scripts/polar-setup.mjs --tunnel https://<your>.trycloudflare.com
//
// Reads POLAR_ACCESS_TOKEN + POLAR_SERVER from .env, then:
//   1. validates the token (with an environment-mismatch hint on 401),
//   2. verifies the POLAR_PRODUCT_* ids exist; creates the missing one-time
//      "100 interview minutes" pack ($34) and writes its id back to .env,
//   3. ensures ONE webhook endpoint for <tunnel>/api/billing/webhook:
//      creates it (events: subscription.created/updated, order.paid) and
//      writes POLAR_WEBHOOK_SECRET to .env — or, when an endpoint for
//      /api/billing/webhook already exists, just PATCHes its URL to the new
//      tunnel so the SECRET STAYS STABLE across dev sessions.
//
// No secrets are printed. Restart the dev server after .env changes.

import fs from "node:fs";
import path from "node:path";

const ENV_PATH = path.join(process.cwd(), ".env");
const WEBHOOK_PATH = "/api/billing/webhook";
const EVENTS = ["subscription.created", "subscription.updated", "order.paid"];
const PACK = { name: "100 interview minutes", priceUsdCents: 3400 };

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

const productKeys = [
  ["POLAR_PRODUCT_STARTER", "Starter (subscription)"],
  ["POLAR_PRODUCT_GROWTH", "Growth (subscription)"],
  ["POLAR_PRODUCT_BYOM", "BYOM (subscription)"],
];
for (const [key, label] of productKeys) {
  const id = env.get(key);
  if (!id) console.warn(`! ${key} is empty — create the ${label} product and fill it in`);
  else if (!products.some((p) => p.id === id)) console.warn(`! ${key}=${id} not found in this ${server} org — wrong id or wrong org?`);
  else console.log(`✓ ${key} ok`);
}

let packId = env.get("POLAR_PRODUCT_MINUTE_PACK");
if (packId && products.some((p) => p.id === packId)) {
  console.log("✓ POLAR_PRODUCT_MINUTE_PACK ok");
} else {
  const existing = products.find((p) => !p.is_recurring && p.name === PACK.name && !p.is_archived);
  const product =
    existing ??
    (await polar("POST", "/v1/products", {
      name: PACK.name,
      recurring_interval: null,
      prices: [{ amount_type: "fixed", price_currency: "usd", price_amount: PACK.priceUsdCents }],
    }));
  packId = product.id;
  writeEnvKey("POLAR_PRODUCT_MINUTE_PACK", packId);
  console.log(`✓ minute pack ${existing ? "found" : "created"} → POLAR_PRODUCT_MINUTE_PACK=${packId}`);
}

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
