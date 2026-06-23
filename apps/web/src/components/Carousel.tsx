import { useState } from "react";

export interface Slide { icon: string; title: string; body: string; }

export function Carousel({ slides }: { slides: Slide[] }) {
  const [i, setI] = useState(0);
  const s = slides[i];
  return (
    <div style={{ position: "absolute", bottom: 48, left: 48, right: 48, color: "#fff" }}>
      <div style={{ width: 44, height: 44, display: "grid", placeItems: "center", background: "rgba(255,255,255,.12)", borderRadius: 10, fontSize: 20 }}>{s.icon}</div>
      <h2 style={{ fontSize: 30, margin: "20px 0 10px" }}>{s.title}</h2>
      <p style={{ maxWidth: 420, opacity: .8, lineHeight: 1.5 }}>{s.body}</p>
      <div style={{ display: "flex", gap: 8, marginTop: 24 }}>
        {slides.map((_, idx) => (
          <button key={idx} aria-label={`slide ${idx + 1}`} onClick={() => setI(idx)}
            style={{ width: idx === i ? 26 : 8, height: 8, borderRadius: 4, border: "none", cursor: "pointer", background: idx === i ? "#fff" : "rgba(255,255,255,.4)" }} />
        ))}
      </div>
    </div>
  );
}
