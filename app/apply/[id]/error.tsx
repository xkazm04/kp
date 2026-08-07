"use client";

// Route-level error boundary for /apply/[id] — the public conversational apply flow (covers /apply/[id] and /apply/[id]/quick).
// Why here: getJob/buildApplyScript run sqlite reads server-side; a fault renders the branded retry panel instead of a raw 500 on a public ad link.
// Renders inside the root layout (NextIntlClientProvider above), so the shared
// panel localizes via useTranslations; the loading/error copy lives in the
// `resilience` catalog namespace.
export { RouteError as default } from "@/app/_components/RouteError";
