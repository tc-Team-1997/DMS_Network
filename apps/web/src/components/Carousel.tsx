import { useState, useEffect } from "react";

export interface Slide { icon: string; title: string; body: string; }

const DWELL_MS = 5500;

export function Carousel({ slides }: { slides: Slide[] }) {
  const [i, setI] = useState(0);

  // Auto-advance; re-armed whenever the active slide changes (so manual nav
  // restarts the dwell). Cleared on unmount.
  useEffect(() => {
    if (slides.length <= 1) return;
    const id = setInterval(() => setI((v) => (v + 1) % slides.length), DWELL_MS);
    return () => clearInterval(id);
  }, [slides.length, i]);

  const s = slides[i];
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center", // vertically centered in the panel
        padding: "0 56px",
        color: "#fff",
      }}
    >
      {/* key={i} remounts the block so the fade animation replays smoothly */}
      <div key={i} className="carousel-slide" style={{ maxWidth: 460 }}>
        <div style={{ width: 44, height: 44, display: "grid", placeItems: "center", background: "rgba(255,255,255,.12)", borderRadius: 10, fontSize: 20 }}>{s.icon}</div>
        <h2 style={{ fontSize: 32, margin: "22px 0 12px", lineHeight: 1.15 }}>{s.title}</h2>
        <p style={{ maxWidth: 440, opacity: .8, lineHeight: 1.6, fontSize: 15, margin: 0 }}>{s.body}</p>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 30 }}>
        {slides.map((_, idx) => (
          <button
            key={idx}
            aria-label={`slide ${idx + 1}`}
            onClick={() => setI(idx)}
            style={{
              width: idx === i ? 26 : 8,
              height: 8,
              borderRadius: 4,
              border: "none",
              cursor: "pointer",
              background: idx === i ? "#fff" : "rgba(255,255,255,.4)",
              transition: "width .3s ease, background .3s ease",
            }}
          />
        ))}
      </div>
    </div>
  );
}
