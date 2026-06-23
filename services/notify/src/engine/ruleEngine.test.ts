import { describe, it, expect } from "vitest";
import { evaluateRule, parseRule, type AlertRule } from "./ruleEngine.js";

const expiryRule: AlertRule = {
  id: 1, name: "expiry", trigger: "document.expiring",
  params: {}, channels: ["email", "sms"], escalationTarget: null, scope: null, enabled: true,
};

describe("evaluateRule", () => {
  it("does not fire when the trigger does not match the event", () => {
    const d = evaluateRule(expiryRule, { type: "workflow.escalated", payload: {} });
    expect(d.fire).toBe(false);
    expect(d.reason).toBe("trigger_mismatch");
  });

  it("fires critical for an expiry within 7 days and collects recipients", () => {
    const d = evaluateRule(expiryRule, {
      type: "document.expiring",
      payload: { docId: "D1", docType: "BT_CID_4G", daysToExpiry: 5, branchManager: "BranchManager", customerMobile: "+97517123456" },
    });
    expect(d.fire).toBe(true);
    expect(d.level).toBe("critical");
    expect(d.channels).toEqual(["email", "sms"]);
    expect(d.recipients).toEqual(expect.arrayContaining([
      { kind: "role", value: "BranchManager" },
      { kind: "external", value: "+97517123456" },
    ]));
  });

  it("fires warning for an expiry 30 days out", () => {
    const d = evaluateRule(expiryRule, { type: "document.expiring", payload: { docId: "D1", daysToExpiry: 30 } });
    expect(d.level).toBe("warning");
  });

  it("respects scope: skips events from other branches", () => {
    const scoped: AlertRule = { ...expiryRule, scope: "Thimphu" };
    const d = evaluateRule(scoped, { type: "document.expiring", payload: { daysToExpiry: 1, branch: "Paro" } });
    expect(d.fire).toBe(false);
    expect(d.reason).toBe("out_of_scope");
  });

  it("escalation rule fires critical to the escalation target role", () => {
    const escRule: AlertRule = { id: 2, name: "esc", trigger: "workflow.escalated", params: {}, channels: ["teams"], escalationTarget: "Supervisor", scope: null, enabled: true };
    const d = evaluateRule(escRule, { type: "workflow.escalated", payload: { workflowId: "WF7", assignees: ["alice"] } });
    expect(d.fire).toBe(true);
    expect(d.level).toBe("critical");
    expect(d.recipients).toEqual(expect.arrayContaining([
      { kind: "role", value: "Supervisor" },
      { kind: "user", value: "alice" },
    ]));
  });

  it("parseRule decodes a DB row into an AlertRule", () => {
    const rule = parseRule({ id: 9, name: "r", trigger: "document.expiring", params_json: '{"a":1}', channels: '["email"]', escalation_target: null, scope: null, enabled: 1 });
    expect(rule.channels).toEqual(["email"]);
    expect(rule.params).toEqual({ a: 1 });
    expect(rule.enabled).toBe(true);
  });
});
