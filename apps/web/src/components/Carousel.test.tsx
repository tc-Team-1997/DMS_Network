import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Carousel } from "./Carousel.js";

const slides = [
  { icon: "📄", title: "Capture, classify, index.", body: "Multi-channel capture." },
  { icon: "🧭", title: "Maker–checker workflows.", body: "Approval chains." },
];

describe("Carousel", () => {
  it("shows the first slide and switches on dot click", () => {
    render(<Carousel slides={slides} />);
    expect(screen.getByText("Capture, classify, index.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /highlight 2/i }));
    expect(screen.getByText("Maker–checker workflows.")).toBeInTheDocument();
  });
});
