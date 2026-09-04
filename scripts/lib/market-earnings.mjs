/*
 * market-earnings.mjs — the *earnings* half of the Market Pulse data model.
 *
 * Market Pulse mixes two very different kinds of number, and the page used to
 * blur them:
 *
 *   counts   — how many jobs are open, from the ÚP vacancy register (mpsv-vpm).
 *              Real counts of real postings. Kept as-is.
 *   salaries — what people are PAID. These must come from an earnings survey,
 *              never from what an advert says.
 *
 * The regional/national/sector medians on the page were derived from the salary
 * *advertised* in ÚP postings, and the result was indefensible: a national
 * median of 29 000 Kč and Prague dead last at 24 100 Kč — below every other
 * region, in the highest-paying city in the country. Two biases stack up.
 * Employers advertise the bottom of their band, and ÚP-registered vacancies
 * skew hard to service/manual roles (higher-skill and senior corporate jobs go
 * to commercial boards) — most of all in Prague. An advertised median is a
 * statistic about adverts, not about pay.
 *
 * The fix is to read pay from the survey that measures pay. MPSV publishes ISPV
 * (Informační systém o průměrném výdělku) as open data on the same tree kp
 * already pulls its codelists from:
 *
 *   ispv-zamestnani.json  — national, per CZ-ISCO occupation × wage sphere
 *   regionalni-statistika-ceny-prace.json — the RSCP regional cut, the same
 *                           schema plus a `kraj` column (14 regions)
 *
 * Both are plain public JSON over HTTPS, so this module needs no Pumper — that
 * is what lets scripts/refresh-market-earnings.mjs re-level a committed
 * snapshot without a local ingest server.
 *
 * Source: MPSV ČR (ISPV / RSCP), CC BY 4.0.
 *
 * STALENESS CONTRACT. Nothing rebuilds data/market_pulse.json automatically:
 * `npm run market:build` / `npm run market:earnings` are run by an owner, by
 * hand. The /market page treats a snapshot older than STALE_AFTER_DAYS = 60
 * (app/landing/spark/market/data.ts) as stale and prints its age in the hero
 * instead of quietly serving year-old pay figures. So sixty days is the cadence
 * this module exists to serve — past it the page is telling every visitor the
 * data is old. See docs/features/marketing/README.md.
 *
 * NETWORK CONTRACT. Every fetch here goes through fetchJson(): a
 * FETCH_TIMEOUT_MS (20 s) AbortSignal.timeout and a KP_OFFLINE refusal. Both
 * exist because this module runs inside build scripts — a hung data.mpsv.cz
 * socket used to hang `npm run market:build` forever with no output, and an
 * air-gapped install (docs/architecture/self-hosting.md §7) must be told the
 * script cannot run rather than watch it stall until the kernel gives up.
 */

export const ISPV_NATIONAL_URL = "https://data.mpsv.cz/od/soubory/ispv-zamestnani/ispv-zamestnani.json";
export const ISPV_REGIONAL_URL =
  "https://data.mpsv.cz/od/soubory/regionalni-statistika-ceny-prace/regionalni-statistika-ceny-prace.json";

/** Round to the nearest hundred — matches the precision the rest of the
 *  snapshot publishes, and stops a survey estimate reading like a payslip. */
export const round100 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v / 100) * 100);

/** How long any one MPSV/Pumper GET may take before the build gives up. Twenty
 *  seconds: data.mpsv.cz serves multi-megabyte JSON and is occasionally slow, so
 *  this is generous for a healthy endpoint and instant for a dead one. A bare
 *  `await fetch(url)` has NO timeout — an endpoint that accepts the connection
 *  and never answers hangs `npm run market:build` until someone notices. */
export const FETCH_TIMEOUT_MS = 20_000;

/** Mirrors isOffline() in app/_lib/offline.ts — these scripts run under bare
 *  `node`, so they cannot import the TS module. Keep the vocabulary in step. */
const TRUTHY = new Set(["1", "true", "yes", "on"]);

/** True when KP_OFFLINE is set to a truthy value. */
export function isOffline(env = process.env) {
  return TRUTHY.has(String(env.KP_OFFLINE ?? "").trim().toLowerCase());
}

/**
 * The one GET every market script makes. Pure apart from the injected fetch, so
 * the fixtures can drive every branch without a network.
 *
 * Three failure modes, each with its own sentence, because the operator running
 * `npm run market:build` reads only the last line before the exit code:
 *   - KP_OFFLINE on  → refuse BEFORE touching the socket, and say the snapshot
 *     is committed so an offline install needs no rebuild.
 *   - timeout        → name the budget that was exceeded, not `AbortError`.
 *   - non-2xx        → name the status.
 */
export async function fetchJson(url, { fetchImpl = fetch, timeoutMs = FETCH_TIMEOUT_MS, env = process.env } = {}) {
  if (isOffline(env)) {
    throw new Error(
      `KP_OFFLINE is set — refusing to fetch ${url}. The market snapshot (data/market_pulse.json) is ` +
        `committed, so an offline install needs no rebuild; unset KP_OFFLINE to refresh it.`
    );
  }
  let r;
  try {
    r = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const name = err && typeof err === "object" ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new Error(`GET ${url} → no response within ${timeoutMs} ms (FETCH_TIMEOUT_MS) — giving up.`);
    }
    throw new Error(`GET ${url} → ${(err && err.message) || err}`);
  }
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  return r.json();
}

const getJson = (url) => fetchJson(url);

/**
 * Fetch both ISPV cuts and drop unusable rows.
 *
 * The regional distribution ends with an all-zero sentinel row (`czIsco:
 * "CzIsco/"`, empty `kraj`/`sfera`/`obdobi`); left in, it would land in the
 * distribution as a 0 Kč occupation. Every filter below is load-bearing.
 */
export async function fetchIspv() {
  const [nationalRaw, regionalRaw] = await Promise.all([getJson(ISPV_NATIONAL_URL), getJson(ISPV_REGIONAL_URL)]);
  const usable = (r) => r && r.sfera && r.czIsco && r.czIsco.length > "CzIsco/".length && Number(r.medianMzda) > 0;
  const national = (nationalRaw.polozky || []).filter(usable);
  const regional = (regionalRaw.polozky || []).filter((r) => usable(r) && r.kraj);
  if (!national.length) throw new Error("ISPV national: no usable rows");
  if (!regional.length) throw new Error("ISPV regional (RSCP): no usable rows");
  return {
    national,
    regional,
    // The two files spell the period differently ("rok 2025" vs "2025"), so
    // normalise to the bare year rather than surfacing both spellings.
    period: String(regional[0].obdobi || national[0].obdobi || "").replace(/^rok\s+/i, "") || null
  };
}

/**
 * Headcount-weighted quantile of one ISPV column across a set of occupation
 * rows.
 *
 * ISPV publishes one row per occupation, each already summarised (its own
 * median, quartiles, deciles) and carrying the headcount behind it
 * (`pocetZamestnancuMzda`, in thousands). To get a figure for a whole region we
 * therefore need a quantile *over occupations weighted by employment*, not a
 * plain mean of medians: the mean is dragged upward by a handful of tiny,
 * very-well-paid occupations and lands near the average wage rather than the
 * median. On the 2025 data that is the difference between a defensible 53 600 Kč
 * for Prague and an inflated 60 700 Kč.
 */
export function weightedQuantile(rows, field, q) {
  const points = rows
    .filter((r) => Number(r[field]) > 0)
    .map((r) => [Number(r[field]), Number(r.pocetZamestnancuMzda) || 0.01])
    .sort((a, b) => a[0] - b[0]);
  if (!points.length) return null;
  const total = points.reduce((sum, [, w]) => sum + w, 0);
  let seen = 0;
  for (const [value, weight] of points) {
    seen += weight;
    if (seen >= total * q) return value;
  }
  return points[points.length - 1][0];
}

/**
 * The three figures the page shows for any earnings population: the median and
 * the middle-50% band.
 *
 * `p25`/`p75` are the weighted median of the occupations' own Q1/Q3 columns —
 * "what the typical occupation's lower/upper quartile looks like" — not a
 * quartile of quartiles, which would double-count dispersion and produce an
 * absurdly wide band (Prague's top would read 95 000 Kč instead of 68 300 Kč).
 */
export function earningsTriple(rows) {
  if (!rows.length) return { median: null, p25: null, p75: null, employees_k: 0 };
  return {
    median: round100(weightedQuantile(rows, "medianMzda", 0.5)),
    p25: round100(weightedQuantile(rows, "diferenciaceQ1M", 0.5)),
    p75: round100(weightedQuantile(rows, "diferenciaceQ3M", 0.5)),
    employees_k: Math.round(rows.reduce((sum, r) => sum + (Number(r.pocetZamestnancuMzda) || 0), 0))
  };
}

/** krajId (`"Kraj/19"`) → earnings triple, from the RSCP regional cut. */
export function regionalEarnings(regional) {
  const byKraj = new Map();
  for (const row of regional) {
    if (!byKraj.has(row.kraj)) byKraj.set(row.kraj, []);
    byKraj.get(row.kraj).push(row);
  }
  return new Map([...byKraj].map(([kraj, rows]) => [kraj, earningsTriple(rows)]));
}

/**
 * The org-type split, on an earnings basis.
 *
 * ISPV's `sfera` is exactly the private/public cut the page already shows:
 * MZDOVA is the wage (business) sphere, PLATOVA the salary (public) sphere.
 * Staffing agencies have no counterpart in the survey — they are an attribute
 * of who posts a vacancy, not a sphere of the economy — so `agency` maps to
 * null on purpose. The page renders that tile without a pay figure rather than
 * quoting an advertised number next to two survey ones.
 */
export function sphereEarnings(national) {
  return {
    private: earningsTriple(national.filter((r) => r.sfera === "MZDOVA")),
    public: earningsTriple(national.filter((r) => r.sfera === "PLATOVA")),
    agency: null
  };
}

/** Whole-economy earnings, national. */
export function nationalEarnings(national) {
  return earningsTriple(national);
}
