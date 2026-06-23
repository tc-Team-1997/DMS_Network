import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password hashing", () => {
  it("hashes a plaintext password", async () => {
    const hash = await hashPassword("secret123");
    expect(hash).not.toBe("secret123");
    expect(hash.startsWith("$2")).toBe(true); // bcrypt prefix
  });

  it("verifies the correct password", async () => {
    const hash = await hashPassword("mypassword");
    expect(await verifyPassword("mypassword", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct");
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
});
