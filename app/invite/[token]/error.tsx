"use client";

// Route-level error boundary for /invite/[token] — the invited member's first
// contact with the product. The client form fetches its own preview, but a render
// crash (a bad payload shape, a bug in the form) must not strand a new colleague on
// Next's default screen — every sibling public door (offer, skill, schedule)
// already has this boundary; invite was the one without it. Renders inside the
// root layout (NextIntlClientProvider above), so the shared panel localizes via
// useTranslations; the copy lives in the `resilience` catalog namespace.
export { RouteError as default } from "@/app/_components/RouteError";
