import { describe, it, expect } from "vitest";
import { compileTemplate, passesConfidenceGate } from "./compileTemplate.js";

describe("compileTemplate", () => {
  it("compiles ordered steps with defaults applied", () => {
    const json = JSON.stringify([
      { name: "Maker submits", required_permissions: ["workflow:act"], sla_minutes: 60 },
      { name: "Checker approves", required_permissions: ["document:approve"], min_confidence: 0.95 },
    ]);
    const steps = compileTemplate(json);
    expect(steps).toHaveLength(2);
    expect(steps[0].name).toBe("Maker submits");
    expect(steps[0].min_confidence).toBe(0.9);
    expect(steps[1].min_confidence).toBe(0.95);
    expect(steps[1].required_permissions).toEqual(["document:approve"]);
  });

  it("defaults required_permissions to workflow:act", () => {
    const steps = compileTemplate(JSON.stringify([{ name: "Review" }]));
    expect(steps[0].required_permissions).toEqual(["workflow:act"]);
  });

  it("throws on malformed JSON", () => {
    expect(() => compileTemplate("{not json")).toThrow(/invalid_steps_json/);
  });

  it("throws on an empty step list", () => {
    expect(() => compileTemplate("[]")).toThrow(/empty_template/);
  });

  it("throws when a step is missing a name", () => {
    expect(() =>
      compileTemplate(JSON.stringify([{ required_permissions: [] }])),
    ).toThrow(/step_name_required/);
  });
});

describe("passesConfidenceGate", () => {
  it("passes at or above the floor", () => {
    expect(passesConfidenceGate(0.9, 0.9)).toBe(true);
    expect(passesConfidenceGate(0.9, 0.95)).toBe(true);
  });
  it("fails below the floor", () => {
    expect(passesConfidenceGate(0.9, 0.89)).toBe(false);
  });
});
