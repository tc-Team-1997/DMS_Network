import { describe, it, expect } from "vitest";
import { newId } from "./id.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newId", () => {
  it("returns a 36-char string", () => {
    expect(newId()).toHaveLength(36);
  });

  it("matches canonical UUID format with version nibble 7", () => {
    expect(newId()).toMatch(UUID_RE);
  });

  it("produces unique values over 1000 calls", () => {
    const ids = Array.from({ length: 1000 }, () => newId());
    expect(new Set(ids).size).toBe(1000);
  });

  it("is monotonically non-decreasing (lexicographic)", () => {
    const ids = Array.from({ length: 100 }, () => newId());
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i] >= ids[i - 1]).toBe(true);
    }
  });
});
