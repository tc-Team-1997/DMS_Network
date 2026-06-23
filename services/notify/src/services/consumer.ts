import type { AlertDeps } from "./alertService.js";
import { raiseAlert } from "./alertService.js";
import { evaluateRule, parseRule } from "../engine/ruleEngine.js";
import type { DomainEvent } from "../bus/types.js";

const TRIGGERS = ["document.expiring", "workflow.escalated"];

export function attachConsumer(deps: AlertDeps): void {
  const handler = async (event: DomainEvent): Promise<void> => {
    const rows = await deps.knex("alert_rules").where({ trigger: event.type, enabled: true });
    for (const row of rows) {
      const rule = parseRule(row);
      const decision = evaluateRule(rule, event);
      if (decision.fire) {
        await raiseAlert(deps, {
          decision, ruleId: rule.id,
          branch: (event.payload as any)?.branch,
          meta: event.payload as Record<string, unknown>,
        });
      }
    }
  };
  for (const t of TRIGGERS) deps.bus.subscribe(t, handler);
}
