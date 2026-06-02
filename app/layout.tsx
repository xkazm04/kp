import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap"
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  weight: ["400", "500", "600", "700"]
});

const SITE_TITLE = "KP Job Fit & Salary Estimator";
const SITE_DESCRIPTION = "AI-assisted CV seniority scoring and salary estimation pipeline for the Czech market.";

// Anchors relative OG/Twitter image URLs to an absolute origin. Without it Next
// falls back to http://localhost:3000 and warns at build. Overridable per deploy
// via NEXT_PUBLIC_SITE_URL; defaults to the project's own domain.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://nuda.dev";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  applicationName: "KP Job Fit & Salary Estimator",
  authors: [{ name: "Michal Kazdan", url: "https://nuda.dev" }],
  creator: "Michal Kazdan",
  keywords: [
    "CV scoring",
    "job fit",
    "salary estimation",
    "Czech market",
    "seniority assessment",
    "AI hiring tools"
  ],
  openGraph: {
    type: "website",
    siteName: SITE_TITLE,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    locale: "en_US"
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
