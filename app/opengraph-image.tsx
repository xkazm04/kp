import { ImageResponse } from "next/og";
import { loadGoogleFont } from "@/app/_lib/og-fonts";

export const alt = "KP Job Fit & Salary Estimator — Czech market";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PAPER = "#f7f5ef";
const INK = "#17202a";
const CORAL = "#d65a4a";
const STEEL = "#42606f";
const MOSS = "#526b4f";
const LIMEWASH = "#dce7d0";

export default async function OpengraphImage() {
  const [serif600, serif700, sans500] = await Promise.all([
    loadGoogleFont("Fraunces", 600),
    loadGoogleFont("Fraunces", 700),
    loadGoogleFont("Inter", 500)
  ]);

  const fonts: Array<{
    name: string;
    data: ArrayBuffer;
    weight: 400 | 500 | 600 | 700;
    style: "normal";
  }> = [];
  if (serif600) fonts.push({ name: "Fraunces", data: serif600, weight: 600, style: "normal" });
  if (serif700) fonts.push({ name: "Fraunces", data: serif700, weight: 700, style: "normal" });
  if (sans500) fonts.push({ name: "Inter", data: sans500, weight: 500, style: "normal" });

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: PAPER,
          padding: 72,
          fontFamily: "Inter, sans-serif"
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            opacity: 0.08
          }}
        >
          <svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
            <ellipse cx="240" cy="540" rx="220" ry="22" fill={LIMEWASH} />
            <rect x="118" y="160" width="320" height="400" rx="14" fill={INK} opacity="0.5" />
            <rect x="100" y="142" width="320" height="400" rx="14" fill={PAPER} stroke={INK} strokeWidth="3" />
            <path d="M100 160 L100 200 L150 160 Z" fill={CORAL} />
            <line x1="100" y1="226" x2="420" y2="226" stroke={INK} strokeWidth="2" />
            <circle cx="180" cy="195" r="22" fill={MOSS} stroke={INK} strokeWidth="2" />
            <rect x="232" y="180" width="170" height="14" rx="3" fill={INK} />
            <rect x="232" y="206" width="120" height="10" rx="3" fill={STEEL} />
            <g stroke={STEEL} strokeWidth="6" strokeLinecap="round">
              <line x1="130" y1="284" x2="400" y2="284" />
              <line x1="130" y1="306" x2="370" y2="306" />
              <line x1="130" y1="328" x2="390" y2="328" />
            </g>
            <g>
              <rect x="130" y="368" width="80" height="22" rx="11" fill={LIMEWASH} stroke={INK} strokeWidth="2" />
              <rect x="218" y="368" width="100" height="22" rx="11" fill={LIMEWASH} stroke={INK} strokeWidth="2" />
              <rect x="326" y="368" width="68" height="22" rx="11" fill={CORAL} stroke={INK} strokeWidth="2" />
            </g>
            <g stroke={CORAL} strokeWidth="3" fill="none" strokeLinecap="round">
              <path d="M450 350 C 640 240, 880 220, 1120 230" />
              <path d="M450 350 C 660 320, 880 320, 1120 330" />
              <path d="M450 350 C 660 400, 880 430, 1120 450" />
            </g>
            <g stroke={STEEL} strokeWidth="2" fill="none" strokeLinecap="round" strokeDasharray="4 10">
              <path d="M450 350 C 640 240, 880 220, 1120 230" />
              <path d="M450 350 C 660 320, 880 320, 1120 330" />
              <path d="M450 350 C 660 400, 880 430, 1120 450" />
            </g>
            <circle cx="450" cy="350" r="10" fill={INK} />
            <circle cx="450" cy="350" r="20" fill="none" stroke={CORAL} strokeWidth="3" />
          </svg>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            zIndex: 1
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 96,
                height: 96,
                borderRadius: 18,
                background: PAPER,
                border: `3px solid ${INK}`,
                color: CORAL,
                fontFamily: "Fraunces, serif",
                fontWeight: 700,
                fontSize: 56,
                letterSpacing: -2
              }}
            >
              KP
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 500,
                  color: CORAL,
                  letterSpacing: 3,
                  textTransform: "uppercase"
                }}
              >
                KP Case Study
              </div>
              <div
                style={{
                  fontSize: 30,
                  color: STEEL,
                  marginTop: 6,
                  fontFamily: "Fraunces, serif",
                  fontWeight: 600
                }}
              >
                Czech market
              </div>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 22,
              color: STEEL,
              letterSpacing: 2,
              textTransform: "uppercase"
            }}
          >
            nuda.dev
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            zIndex: 1,
            marginTop: 24
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 116,
              fontWeight: 700,
              color: INK,
              lineHeight: 1.02,
              fontFamily: "Fraunces, serif",
              letterSpacing: -3
            }}
          >
            Job Fit &amp;
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 116,
              fontWeight: 700,
              color: INK,
              lineHeight: 1.02,
              fontFamily: "Fraunces, serif",
              letterSpacing: -3,
              marginTop: 8
            }}
          >
            Salary Estimator
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "flex-end",
            justifyContent: "space-between",
            zIndex: 1
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 28,
              color: STEEL,
              maxWidth: 760,
              lineHeight: 1.4,
              fontWeight: 500
            }}
          >
            AI-assisted CV seniority scoring and salary estimation pipeline.
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <div style={{ display: "flex", width: 220, height: 4, background: CORAL, borderRadius: 2 }} />
            <div
              style={{
                display: "flex",
                fontSize: 18,
                color: STEEL,
                letterSpacing: 3,
                textTransform: "uppercase",
                marginTop: 12,
                fontWeight: 500
              }}
            >
              Seniority · Skills · Salary
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts
    }
  );
}
