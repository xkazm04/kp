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

export const metadata: Metadata = {
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
