import { describe, it, expect } from "vitest";
import { signBody, verifySignature } from "./hmac.js";

const secret = "whsec_test";
const raw = '{"event":"cbs.customer.updated","cid":"C1"}';

describe("webhook hmac", () => {
  it("signs with the sha256= prefix and verifies its own signature", () => {
    const sig = signBody(raw, secret);
    expect(sig.startsWith("sha256=")).toBe(true);
    expect(verifySignature(raw, secret, sig)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const sig = signBody(raw, secret);
    expect(verifySignature(raw + " ", secret, sig)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const sig = signBody(raw, "other");
    expect(verifySignature(raw, secret, sig)).toBe(false);
  });

  it("returns false (no throw) for missing or malformed headers", () => {
    expect(verifySignature(raw, secret, undefined)).toBe(false);
    expect(verifySignature(raw, secret, "sha256=zz")).toBe(false);
    expect(verifySignature(raw, secret, "garbage")).toBe(false);
  });

  it("verifies against the exact raw bytes, not a re-serialized body", () => {
    // The raw body has extra whitespace that JSON.stringify would strip.
    // This simulates what happens if a webhook handler re-serializes the parsed body
    // before verifying — key ordering aside, whitespace differences would break verification.
    const rawWithSpaces = '{ "z" : 1 , "a" : 2 }';
    const sig = signBody(rawWithSpaces, secret);
    // Re-serialize would produce compact JSON without whitespace.
    const reserialized = JSON.stringify(JSON.parse(rawWithSpaces));
    expect(reserialized).not.toBe(rawWithSpaces); // whitespace stripped — definitely different
    expect(verifySignature(reserialized, secret, sig)).toBe(false); // proves raw-body discipline matters
    expect(verifySignature(rawWithSpaces, secret, sig)).toBe(true);
  });
});
