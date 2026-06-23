import { describe, it, expect } from "vitest";
import { computeExpiryMilestones, EXPIRY_TIERS } from "./expiryTiers.js";

describe("computeExpiryMilestones", () => {
  it("produces the four IDP §4.3 milestones with correct fire dates", () => {
    // expiry 2026-12-31; today well before T-60
    const ms = computeExpiryMilestones("2026-12-31", "2026-01-01");
    expect(ms.map((m) => m.tier)).toEqual(["T-60", "T-30", "T-07", "T-00"]);
    const t60 = ms.find((m) => m.tier === "T-60")!;
    expect(t60.fireDate).toBe("2026-11-01"); // 60 days before 2026-12-31
    expect(t60.channels).toEqual(["email"]);
    const t00 = ms.find((m) => m.tier === "T-00")!;
    expect(t00.fireDate).toBe("2026-12-31");
    expect(t00.channels).toEqual(["email", "whatsapp"]);
  });

  it("encodes the exact channel matrix from IDP 4.3", () => {
    expect(EXPIRY_TIERS.find((t) => t.tier === "T-30")!.channels).toEqual(["email", "sms"]);
    expect(EXPIRY_TIERS.find((t) => t.tier === "T-07")!.channels).toEqual(["email", "sms", "whatsapp"]);
    expect(EXPIRY_TIERS.find((t) => t.tier === "T-07")!.recipients).toContain("Compliance");
  });

  it("excludes milestones whose fire date is already in the past", () => {
    // today is 2026-12-02: T-60 (2026-11-01) and T-30 (2026-12-01) are in the past,
    // only T-07 (2026-12-24) and T-00 (2026-12-31) remain
    const ms = computeExpiryMilestones("2026-12-31", "2026-12-02");
    expect(ms.map((m) => m.tier)).toEqual(["T-07", "T-00"]);
  });

  it("sorts milestones ascending by fire date", () => {
    const ms = computeExpiryMilestones("2026-12-31", "2026-01-01");
    const dates = ms.map((m) => m.fireDate);
    expect([...dates].sort()).toEqual(dates);
  });
});
