"use client";

// Route-level error boundary for /jds/[slug] — the JD detail page (force-dynamic, sqlite-backed; operator-facing outside the '/' workspace client shell).
// Why here: getJob/loadJd run sqlite reads server-side; a fault renders the branded retry panel.
// Renders inside the root layout (NextIntlClientProvider above), so the shared
// panel localizes via useTranslations; the loading/error copy lives in the
// `resilience` catalog namespace.
export { RouteError as default } from "@/app/_components/RouteError";
