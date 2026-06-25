import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";
import { signToken, verifyToken } from "./tokens.js";

const ALICE_ID = "018f4e3a-1b2c-7d4e-8f5a-6b7c8d9e0f1a";
const BOB_ID   = "018f4e3a-1b2c-7d4e-8f5a-000000000001";

describe("tokens", () => {
  it("round-trips a payload", () => {
    const t = signToken({ sub: ALICE_ID, username: "alice" }, "secret");
    const p = verifyToken(t, "secret");
    expect(p.sub).toBe(ALICE_ID);
    expect(p.username).toBe("alice");
  });
  it("rejects a token signed with a different secret", () => {
    const t = signToken({ sub: BOB_ID, username: "x" }, "secret");
    expect(() => verifyToken(t, "other")).toThrow();
  });
  it("rejects a token with missing payload fields", () => {
    const t = jwt.sign({ sub: BOB_ID }, "secret"); // missing username
    expect(() => verifyToken(t, "secret")).toThrow();
  });
});
