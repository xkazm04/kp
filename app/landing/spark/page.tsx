import type { Metadata } from "next";
import { Bricolage_Grotesque, Gabarito, Shantell_Sans } from "next/font/google";
import SparkLanding from "./SparkLanding";

/*
 * Variant A — "Spark". Startup voice: loud, warm, toy-like. Owns its own type
 * system (loaded here, scoped via CSS variables so the workspace fonts stay
 * untouched): Bricolage for display punch, Gabarito for friendly body text,
 * Shantell for the hand-drawn margin notes.
 */
const display = Bricolage_Grotesque({
  subsets: ["latin", "latin-ext"],
  variable: "--font-spark-display",
  display: "swap"
});

const body = Gabarito({
  subsets: ["latin", "latin-ext"],
  variable: "--font-spark-body",
  display: "swap"
});

const hand = Shantell_Sans({
  subsets: ["latin", "latin-ext"],
  variable: "--font-spark-hand",
  weight: ["400", "500"],
  display: "swap"
});

export const metadata: Metadata = {
  title: "Spark — hiring that actually moves"
};

export default function SparkPage() {
  return (
    <div className={`${display.variable} ${body.variable} ${hand.variable}`}>
      <SparkLanding />
    </div>
  );
}
