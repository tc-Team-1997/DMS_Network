import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RefId, isUuid, shortId } from "./RefId.js";

const UUID = "019eff04-a0a5-7686-87b1-82dada327de6";

describe("isUuid / shortId", () => {
  it("recognises canonical UUIDs and rejects business refs", () => {
    expect(isUuid(UUID)).toBe(true);
    expect(isUuid("NLCS-LC-2026-0401")).toBe(false);
    expect(isUuid("WF-12")).toBe(false);
    expect(isUuid(42)).toBe(false);
  });
  it("shortens uuids but leaves refs alone", () => {
    expect(shortId(UUID)).toBe("019eff04");
    expect(shortId("WF-12")).toBe("WF-12");
  });
});

describe("RefId", () => {
  it("shows a short token for a uuid with the full uuid in the title", () => {
    render(<RefId value={UUID} />);
    const el = screen.getByRole("button");
    expect(el).toHaveTextContent("#019eff04");
    expect(el).toHaveAttribute("title", UUID);
  });

  it("renders a business ref verbatim (no copy affordance)", () => {
    render(<RefId value="NLCS-LC-2026-0401" />);
    expect(screen.getByText("NLCS-LC-2026-0401")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows an explicit label but keeps the uuid behind it", () => {
    render(<RefId value={UUID} label="Loan Application" />);
    const el = screen.getByRole("button");
    expect(el).toHaveTextContent("Loan Application");
    expect(el).toHaveAttribute("title", UUID);
  });

  it("copies the full uuid on click", () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    render(<RefId value={UUID} />);
    fireEvent.click(screen.getByRole("button"));
    expect(writeText).toHaveBeenCalledWith(UUID);
  });

  it("renders an em dash for empty values", () => {
    render(<RefId value={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
