import { ImageResponse } from "next/og";

// The share-preview card (Next file convention: app/opengraph-image.tsx). One
// static card for every route without its own — rendered server-side with the
// site's warm-stone palette so a shared Syftly link stops showing a bare,
// imageless preview. Standard OG size, so every platform crops nothing.

export const alt = "Syftly — the decision layer for the tools AI agents buy";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          backgroundColor: "#fbfaf8",
          borderTop: "16px solid #b45309",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", fontSize: 44 }}>
          <span style={{ color: "#1c1917", fontWeight: 700, letterSpacing: "0.08em" }}>
            SYFTLY
          </span>
          <span style={{ color: "#b45309", marginLeft: 18 }}>/ answers</span>
        </div>
        <div
          style={{
            marginTop: 40,
            fontSize: 64,
            lineHeight: 1.15,
            color: "#1c1917",
            fontWeight: 700,
            maxWidth: 980,
          }}
        >
          The decision layer for the tools AI agents buy
        </div>
        <div style={{ marginTop: 36, fontSize: 30, color: "#57534e", maxWidth: 980 }}>
          Best, cheapest and most reliable API per task — from public benchmarks, with sources and
          dates. For humans and agents.
        </div>
      </div>
    ),
    size,
  );
}
