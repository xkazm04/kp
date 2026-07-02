"use client";

// Root route-level error boundary — an uncaught exception in ANY page below
// the root layout (including the '/' workspace shell around its per-tab
// ErrorBoundary, and every segment without its own error.tsx) renders the
// branded retry panel instead of Next's unstyled "Application error" screen.
// This file renders INSIDE the root layout, so NextIntlClientProvider is
// mounted above it and RouteError's useTranslations works. Layout-level
// crashes are the one case this can't catch — app/global-error.tsx owns those.
export { RouteError as default } from "@/app/_components/RouteError";
