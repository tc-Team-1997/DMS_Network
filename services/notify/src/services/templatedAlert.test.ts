import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildServiceKnex, newId } from "@zordms/db";
import { ChannelRegistry } from "../channels/registry.js";
import { FakeAdapter } from "../channels/fake.js";
import { RealtimeHub } from "../realtime/hub.js";
import { InMemoryBus } from "../bus/fake.js";
import { raiseAlert } from "./alertService.js";
import type { RuleDecision } from "../engine/ruleEngine.js";

const migrationsDir = new URL("../migrations", import.meta.url).pathname;
const seedsDir = new URL("../seeds", import.meta.url).pathname;
const db = { client: "sqlite3" as const, host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "" };
const knex = buildServiceKnex({ migrationsDir, seedsDir, db });

beforeAll(async () => {
  process.env.APP_BASE_URL = "https://dms.example.com";
  await knex.migrate.latest();
  await knex.seed.run();
  // A user the role resolves to.
  const id = newId();
  await knex("users").insert({ id, username: "officer", password_hash: "x", full_name: "Officer", email: "officer@bob.bt", status: "Active" });
  const checker = await knex("roles").where({ name: "Checker" }).first();
  await knex("user_roles").insert({ user_id: id, role_id: checker.id });
});
afterAll(async () => { await knex.destroy(); });

const decision: RuleDecision = {
  fire: true, level: "warning", channels: ["email"],
  recipients: [{ kind: "user", value: "officer" }],
  title: "KYC document expiring", reason: "expiry_match",
};

describe("templated alert dispatch (Phase 2)", () => {
  it("renders the bound template (HTML + doc deep-link) for the email channel", async () => {
    const email = new FakeAdapter("email");
    const registry = new ChannelRegistry(); registry.register(email);

    await raiseAlert(
      { knex, registry, hub: new RealtimeHub(), bus: new InMemoryBus() },
      {
        decision,
        templateKey: "kyc_expiry",
        meta: { docId: "DOC-123", docTitle: "Passport — A. Hassan", branch: "Thimphu" },
      },
    );

    expect(email.sent.length).toBe(1);
    const sent = email.sent[0];
    expect(sent.recipient).toBe("officer@bob.bt");
    // Subject came from the template, not the raw decision title.
    expect(sent.subject).toContain("expiring");
    // HTML body is present and carries the absolute document deep-link.
    expect(sent.html).toBeTruthy();
    expect(sent.html).toContain("https://dms.example.com/viewer?doc=DOC-123");
    // Plain-text fallback is also rendered.
    expect(sent.body).toContain("Passport — A. Hassan");
  });

  it("falls back to the plain decision title when no template is bound", async () => {
    const email = new FakeAdapter("email");
    const registry = new ChannelRegistry(); registry.register(email);

    await raiseAlert(
      { knex, registry, hub: new RealtimeHub(), bus: new InMemoryBus() },
      { decision, meta: { docId: "DOC-9" } },
    );

    expect(email.sent.length).toBe(1);
    expect(email.sent[0].subject).toBe("KYC document expiring");
    expect(email.sent[0].html).toBeUndefined();
  });

  it("falls back to plain title when the template key does not exist", async () => {
    const email = new FakeAdapter("email");
    const registry = new ChannelRegistry(); registry.register(email);

    await raiseAlert(
      { knex, registry, hub: new RealtimeHub(), bus: new InMemoryBus() },
      { decision, templateKey: "does_not_exist", meta: {} },
    );

    expect(email.sent[0].subject).toBe("KYC document expiring");
    expect(email.sent[0].html).toBeUndefined();
  });

  it("persists the rendered subject on the notification row", async () => {
    const email = new FakeAdapter("email");
    const registry = new ChannelRegistry(); registry.register(email);

    const { alertId } = await raiseAlert(
      { knex, registry, hub: new RealtimeHub(), bus: new InMemoryBus() },
      { decision, templateKey: "kyc_expiry", meta: { docId: "DOC-5", docTitle: "ID Card" } },
    );

    const row = await knex("notifications").where({ alert_id: alertId, channel: "email" }).first();
    expect(row.subject).toContain("expiring");
  });
});
