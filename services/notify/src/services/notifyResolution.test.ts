import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Transporter } from "nodemailer";
import { buildServiceKnex, newId } from "@zordms/db";
import { ChannelRegistry } from "../channels/registry.js";
import { EmailAdapter } from "../channels/email.js";
import { FakeAdapter } from "../channels/fake.js";
import { RealtimeHub } from "../realtime/hub.js";
import { InMemoryBus } from "../bus/fake.js";
import { raiseAlert } from "./alertService.js";
import { resolveRecipients } from "./escalation.js";
import type { Recipient } from "../engine/ruleEngine.js";

const migrationsDir = new URL("../migrations", import.meta.url).pathname;
const seedsDir = new URL("../seeds", import.meta.url).pathname;
const db = { client: "sqlite3" as const, host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "" };
const knex = buildServiceKnex({ migrationsDir, seedsDir, db });

/** A recording mail transport: stands in for nodemailer and captures `to`. */
function recordingTransport(): { transport: Transporter; sent: Array<{ to: string }> } {
  const sent: Array<{ to: string }> = [];
  const transport = {
    sendMail: async (opts: { to: string }) => {
      sent.push({ to: opts.to });
      return { messageId: `msg-${sent.length}` };
    },
  } as unknown as Transporter;
  return { transport, sent };
}

async function addUser(username: string, email: string | null, roleName: string, status = "Active"): Promise<void> {
  const id = newId();
  await knex("users").insert({ id, username, password_hash: "x", full_name: username, email, status });
  const role = await knex("roles").where({ name: roleName }).first();
  await knex("user_roles").insert({ user_id: id, role_id: role.id });
}

beforeAll(async () => {
  await knex.migrate.latest();
  await knex.seed.run();
  // Two Checkers with distinct emails, one whose email is duplicated, one with no email.
  await addUser("checker.one", "checker.one@bob.bt", "Checker");
  await addUser("checker.two", "checker.two@bob.bt", "Checker");
  await addUser("checker.dup", "checker.one@bob.bt", "Checker"); // duplicate email -> deduped
  await addUser("checker.noemail", null, "Checker"); // missing email -> skipped + warned
});
afterAll(async () => { await knex.destroy(); });

describe("recipient resolution (main path)", () => {
  it("resolves a role target to the active members' real email addresses", async () => {
    const recipients: Recipient[] = [{ kind: "role", value: "Checker" }];
    const resolved = await resolveRecipients(recipients, { knex });
    const emails = resolved.filter((r) => r.channel === "email").map((r) => r.address);
    expect(emails).toContain("checker.one@bob.bt");
    expect(emails).toContain("checker.two@bob.bt");
  });

  it("dedupes identical addresses across a role/group", async () => {
    const resolved = await resolveRecipients([{ kind: "role", value: "Checker" }], { knex });
    const emails = resolved.filter((r) => r.channel === "email").map((r) => r.address);
    // checker.one and checker.dup share an email -> only one entry survives.
    expect(emails.filter((e) => e === "checker.one@bob.bt").length).toBe(1);
  });

  it("skips members with no email and logs a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const resolved = await resolveRecipients([{ kind: "role", value: "Checker" }], { knex });
    const emails = resolved.filter((r) => r.channel === "email").map((r) => r.address);
    expect(emails).not.toContain(null);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("checker.noemail"));
    warn.mockRestore();
  });

  it("treats a group the same as a role (RBAC roles back groups)", async () => {
    const resolved = await resolveRecipients([{ kind: "group", value: "Checker" }], { knex });
    const emails = resolved.filter((r) => r.channel === "email").map((r) => r.address);
    expect(emails).toContain("checker.two@bob.bt");
  });

  it("resolves an explicit user list and dedupes against a role", async () => {
    const resolved = await resolveRecipients(
      [
        { kind: "role", value: "Checker" },
        { kind: "user", value: "checker.one" },
      ],
      { knex },
    );
    const emails = resolved.filter((r) => r.channel === "email").map((r) => r.address);
    // checker.one provided both by role and explicitly -> still a single entry.
    expect(emails.filter((e) => e === "checker.one@bob.bt").length).toBe(1);
  });
});

describe("raiseAlert dispatches REAL email addresses via EmailAdapter", () => {
  it("a role-targeted rule produces resolved email addresses on the dispatched message", async () => {
    const { transport, sent } = recordingTransport();
    const registry = new ChannelRegistry();
    registry.register(new EmailAdapter(transport, "dms@bob.bt"));
    registry.register(new FakeAdapter("inapp"));

    const out = await raiseAlert(
      { knex, registry, hub: new RealtimeHub(), bus: new InMemoryBus() },
      {
        decision: {
          fire: true, level: "critical", channels: ["email"],
          recipients: [{ kind: "role", value: "Checker" }],
          title: "Approval overdue", reason: "escalation_match",
        },
        meta: { workflowId: "WF-1" },
      },
    );

    const toAddrs = sent.map((s) => s.to);
    expect(toAddrs).toContain("checker.one@bob.bt");
    expect(toAddrs).toContain("checker.two@bob.bt");
    // No role NAME string ever reaches the transport.
    expect(toAddrs).not.toContain("Checker");
    // Deduped: checker.one@bob.bt appears once despite two member rows.
    expect(toAddrs.filter((t) => t === "checker.one@bob.bt").length).toBe(1);
    // The skipped (no-email) member produced no email send. Scope the count to
    // this test's own @bob.bt checkers so it is independent of seeded staff
    // Checkers (the notify seed also seeds a real Checker with an email).
    const testCheckers = toAddrs.filter((t) => t.endsWith("@bob.bt"));
    expect(testCheckers.length).toBe(2);

    // Persisted notification rows carry the resolved address + the owning userId.
    const rows = await knex("notifications").where({ alert_id: out.alertId, channel: "email" });
    expect(rows.every((r: any) => r.recipient.includes("@"))).toBe(true);
    expect(rows.some((r: any) => r.user_id)).toBe(true);
  });
});
