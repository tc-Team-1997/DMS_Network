import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { KpiCard } from "./KpiCard.js";

describe("KpiCard", () => {
  it("renders label and value", () => {
    render(<KpiCard label="Total Docs" value="12,847" />);
    expect(screen.getByText("Total Docs")).toBeInTheDocument();
    expect(screen.getByText("12,847")).toBeInTheDocument();
  });

  it("renders optional sub text", () => {
    render(<KpiCard label="Pending" value="18" sub="+3 since yesterday" />);
    expect(screen.getByText("+3 since yesterday")).toBeInTheDocument();
  });

  it("omits sub when not provided", () => {
    const { container } = render(<KpiCard label="Pending" value="18" />);
    expect(container.querySelector(".ks")).toBeNull();
  });

  it("applies the kpi-card CSS class", () => {
    const { container } = render(<KpiCard label="L" value="V" />);
    expect(container.querySelector(".kpi-card")).not.toBeNull();
  });

  it("uses full border, not top stripe (no ::before accent bar)", () => {
    // The component must NOT use the old .kg/.kb/... variant classes
    // (which apply the 2px top-bar via ::before pseudo-element).
    const { container } = render(<KpiCard label="L" value="V" variant="gold" />);
    const card = container.firstChild as HTMLElement;
    // Old variant class names were kg/kb/kok/kr/kp/kw — none should be present
    const classNames = card.className;
    expect(classNames).not.toMatch(/\b(kg|kb|kok|kr|kp|kw)\b/);
  });

  it("renders an accent dot element", () => {
    const { container } = render(<KpiCard label="L" value="V" variant="blue" />);
    // The dot is a span with aria-hidden="true"
    const dot = container.querySelector('span[aria-hidden="true"]');
    expect(dot).not.toBeNull();
  });

  it("accepts a custom className", () => {
    const { container } = render(<KpiCard label="L" value="V" className="my-class" />);
    expect(container.firstChild).toHaveClass("my-class");
  });
});
