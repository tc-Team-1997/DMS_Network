import { describe, it, expect } from "vitest";
import { isAuthUser } from "./index.js";

describe("isAuthUser", () => {
  it("accepts a well-formed auth user", () => {
    expect(isAuthUser({ id: 1, username: "a", roles: ["CDO"], permissions: ["user:create"] })).toBe(true);
  });
  it("rejects a malformed object", () => {
    expect(isAuthUser({ id: 1 })).toBe(false);
  });
});
