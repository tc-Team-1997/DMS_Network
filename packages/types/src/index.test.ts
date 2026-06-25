import { describe, it, expect } from "vitest";
import { isAuthUser } from "./index.js";

describe("isAuthUser", () => {
  it("accepts a well-formed auth user", () => {
    expect(isAuthUser({ id: "018f4e2a-1111-7000-8000-000000000001", username: "a", roles: ["CDO"], permissions: ["user:create"] })).toBe(true);
  });
  it("rejects a malformed object", () => {
    expect(isAuthUser({ id: "018f4e2a-1111-7000-8000-000000000001" })).toBe(false);
  });
  it("rejects a numeric id (old format)", () => {
    expect(isAuthUser({ id: 1, username: "a", roles: ["CDO"], permissions: ["user:create"] })).toBe(false);
  });
});
