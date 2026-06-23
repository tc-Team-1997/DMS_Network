import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";
import { signToken, verifyToken } from "./tokens.js";
describe("tokens", () => {
    it("round-trips a payload", () => {
        const t = signToken({ sub: 7, username: "alice" }, "secret");
        const p = verifyToken(t, "secret");
        expect(p.sub).toBe(7);
        expect(p.username).toBe("alice");
    });
    it("rejects a token signed with a different secret", () => {
        const t = signToken({ sub: 1, username: "x" }, "secret");
        expect(() => verifyToken(t, "other")).toThrow();
    });
    it("rejects a token with missing payload fields", () => {
        const t = jwt.sign({ sub: 1 }, "secret"); // missing username
        expect(() => verifyToken(t, "secret")).toThrow();
    });
});
