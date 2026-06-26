import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { SearchableSelect } from "./SearchableSelect.js";
import type { SelectOption } from "./SearchableSelect.js";

const OPTIONS: SelectOption[] = [
  { value: "role:Supervisor", label: "Supervisor", subLabel: "Role", group: "Roles" },
  { value: "role:CDO", label: "CDO", subLabel: "Role", group: "Roles" },
  { value: "user:pema", label: "Pema", subLabel: "pema · pema@x.com", group: "People" },
  { value: "user:jigme", label: "Jigme", subLabel: "jigme", group: "People" },
];

describe("SearchableSelect", () => {
  it("opens and lists grouped options", () => {
    render(<SearchableSelect options={OPTIONS} value={null} onChange={() => {}} ariaLabel="picker" />);
    fireEvent.click(screen.getByLabelText("picker"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByText("Roles")).toBeInTheDocument();
    expect(screen.getByText("People")).toBeInTheDocument();
    expect(screen.getByText("Supervisor")).toBeInTheDocument();
    expect(screen.getByText("Pema")).toBeInTheDocument();
  });

  it("filters by typing", () => {
    render(<SearchableSelect options={OPTIONS} value={null} onChange={() => {}} ariaLabel="picker" />);
    fireEvent.click(screen.getByLabelText("picker"));
    fireEvent.change(screen.getByPlaceholderText("Type to search…"), { target: { value: "Super" } });
    const listbox = screen.getByRole("listbox");
    expect(within(listbox).getByText("Supervisor")).toBeInTheDocument();
    expect(within(listbox).queryByText("Pema")).not.toBeInTheDocument();
  });

  it("calls onChange with the chosen option's value", () => {
    const onChange = vi.fn();
    render(<SearchableSelect options={OPTIONS} value={null} onChange={onChange} ariaLabel="picker" />);
    fireEvent.click(screen.getByLabelText("picker"));
    fireEvent.click(screen.getByText("Jigme"));
    expect(onChange).toHaveBeenCalledWith("user:jigme", expect.objectContaining({ value: "user:jigme" }));
  });

  it("shows the selected label on the trigger", () => {
    render(<SearchableSelect options={OPTIONS} value="role:CDO" onChange={() => {}} ariaLabel="picker" />);
    expect(screen.getByLabelText("picker")).toHaveTextContent("CDO");
  });

  it("shows an empty state when nothing matches", () => {
    render(<SearchableSelect options={OPTIONS} value={null} onChange={() => {}} ariaLabel="picker" />);
    fireEvent.click(screen.getByLabelText("picker"));
    fireEvent.change(screen.getByPlaceholderText("Type to search…"), { target: { value: "zzz" } });
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });
});
