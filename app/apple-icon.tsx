import { ImageResponse } from "next/og";
import { loadGoogleFont } from "@/app/_lib/og-fonts";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const PAPER = "#f7f5ef";
const INK = "#17202a";
const CORAL = "#d65a4a";

export default async function AppleIcon() {
  const serif = await loadGoogleFont("Fraunces", 700);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: PAPER,
          color: CORAL,
          fontFamily: "Fraunces, serif",
          fontSize: 110,
          fontWeight: 700,
          letterSpacing: -4,
          border: `6px solid ${INK}`,
          borderRadius: 36,
          boxSizing: "border-box"
        }}
      >
        KP
      </div>
    ),
    {
      ...size,
      fonts: serif
        ? [{ name: "Fraunces", data: serif, weight: 700, style: "normal" }]
        : []
    }
  );
}
