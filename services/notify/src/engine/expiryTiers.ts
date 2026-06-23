import type { ChannelKey } from "../channels/types.js";

export type ExpiryTier = "T-60" | "T-30" | "T-07" | "T-00";

export interface TierSpec {
  tier: ExpiryTier;
  daysBefore: number;
  channels: ChannelKey[];
  recipients: string[];
}

// Exact matrix from IDP design §4.3 (expiry alert tiers).
export const EXPIRY_TIERS: TierSpec[] = [
  { tier: "T-60", daysBefore: 60, channels: ["email"], recipients: ["BranchManager", "RelationshipOfficer"] },
  { tier: "T-30", daysBefore: 30, channels: ["email", "sms"], recipients: ["RelationshipOfficer", "Customer"] },
  { tier: "T-07", daysBefore: 7, channels: ["email", "sms", "whatsapp"], recipients: ["BranchManager", "RelationshipOfficer", "Customer", "Compliance"] },
  { tier: "T-00", daysBefore: 0, channels: ["email", "whatsapp"], recipients: ["BranchHead", "ITDMSAdmin"] },
];

export interface ExpiryMilestone {
  tier: ExpiryTier;
  fireDate: string;   // ISO yyyy-mm-dd
  daysBefore: number;
  channels: ChannelKey[];
  recipients: string[];
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shiftDays(iso: string, minusDays: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - minusDays);
  return isoDate(d);
}

export function computeExpiryMilestones(expiryDate: string, today: string = isoDate(new Date())): ExpiryMilestone[] {
  return EXPIRY_TIERS
    .map((t) => ({
      tier: t.tier,
      daysBefore: t.daysBefore,
      channels: t.channels,
      recipients: t.recipients,
      fireDate: shiftDays(expiryDate, t.daysBefore),
    }))
    .filter((m) => m.fireDate >= today)
    .sort((a, b) => (a.fireDate < b.fireDate ? -1 : a.fireDate > b.fireDate ? 1 : 0));
}
