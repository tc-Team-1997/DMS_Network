import { describe, it, expect } from "vitest";
import speakeasy from "speakeasy";
import { generateMfaSecret, verifyTotp } from "./totp.js";

describe("totp", () => {
  it("generates a secret with otpauth url", () => {
    const s = generateMfaSecret("ZorDMS:alice");
    expect(s.base32).toBeTruthy();
    expect(s.otpauthUrl).toContain("otpauth://");
  });
  it("verifies a live token for the secret", () => {
    const s = generateMfaSecret("ZorDMS:alice");
    const token = speakeasy.totp({ secret: s.base32, encoding: "base32" });
    expect(verifyTotp(s.base32, token)).toBe(true);
    expect(verifyTotp(s.base32, "000000")).toBe(false);
  });
});
