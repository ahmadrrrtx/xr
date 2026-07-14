import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #1a1230 0%, #0b0b0f 60%, #0e1a2a 100%)",
          border: "1px solid rgba(168,146,255,0.6)",
          color: "#ffffff",
          fontSize: 16,
          fontWeight: 700,
          fontFamily: "sans-serif",
          letterSpacing: "-0.05em",
          backgroundImage:
            "radial-gradient(circle at 30% 30%, rgba(168,146,255,0.6), transparent 50%)",
        }}
      >
        X
      </div>
    ),
    { ...size }
  );
}
