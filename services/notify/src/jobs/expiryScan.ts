import type { Knex } from "knex";
import type { EventBus } from "../bus/types.js";
import { computeExpiryMilestones } from "../engine/expiryTiers.js";

export interface ExpiringDoc { docId: string; docType: string; expiryDate: string; branch?: string; }

export async function runExpiryScan(
  deps: { knex: Knex; bus: EventBus; today?: string },
  docs: ExpiringDoc[],
): Promise<{ scheduled: number }> {
  const { knex, bus } = deps;
  const today = deps.today ?? new Date().toISOString().slice(0, 10);
  let scheduled = 0;

  for (const doc of docs) {
    const milestones = computeExpiryMilestones(doc.expiryDate, today);
    for (const m of milestones) {
      const existing = await knex("alert_schedule").where({ doc_id: doc.docId, tier: m.tier }).first();
      if (existing?.fired) continue;

      const dueToday = m.fireDate === today;
      if (!existing) {
        await knex("alert_schedule").insert({ doc_id: doc.docId, tier: m.tier, fire_date: m.fireDate, fired: dueToday });
      } else if (dueToday) {
        await knex("alert_schedule").where({ id: existing.id }).update({ fired: true });
      }

      if (dueToday) {
        scheduled += 1;
        await bus.publish({
          type: "document.expiring",
          payload: { docId: doc.docId, docType: doc.docType, daysToExpiry: m.daysBefore, branch: doc.branch, tier: m.tier },
        });
      }
    }
  }
  return { scheduled };
}
