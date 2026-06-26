import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { buildServiceKnex } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { signToken } from "@zordms/auth";
import { ChannelRegistry } from "../channels/registry.js";
import { FakeAdapter } from "../channels/fake.js";
import { RealtimeHub } from "../realtime/hub.js";
import { InMemoryBus } from "../bus/fake.js";
import { createApp } from "../app.js";

const migrationsDir = new URL("../migrations", import.meta.url).pathname;
const seedsDir = new URL("../seeds", import.meta.url).pathname;
const db = { client: "sqlite3" as const, host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "" };
const knex = buildServiceKnex({ migrationsDir, seedsDir, db });
const emailAdapter = new FakeAdapter("email");
const registry = new ChannelRegistry(); registry.register(emailAdapter);
const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv), registry, bus: new InMemoryBus(), hub: new RealtimeHub() });

const MANAGE = ["email_template:read", "email_template:manage"];
const READONLY = ["email_template:read"];

let manageToken = "";
let readonlyToken = "";

beforeAll(async () => {
  process.env.APP_BASE_URL = "https://dms.example.com";
  await knex.migrate.latest();
  await knex.seed.run();
  const admin = await knex("users").where({ username: "admin" }).first();
  manageToken = signToken({ sub: admin.id, username: "admin", roles: ["CDO"], permissions: MANAGE, branch: "HQ" }, "t");
  readonlyToken = signToken({ sub: admin.id, username: "viewer", roles: ["Viewer"], permissions: READONLY, branch: "HQ" }, "t");
});
afterAll(async () => { await knex.destroy(); });

describe("email-template routes", () => {
  it("seeds starter templates", async () => {
    const res = await request(app).get("/templates").set("Authorization", `Bearer ${manageToken}`);
    expect(res.status).toBe(200);
    const keys = res.body.templates.map((t: { key: string }) => t.key);
    expect(keys).toContain("kyc_expiry");
    expect(keys).toContain("workflow_escalation");
  });

  it("exposes the merge-tag catalog", async () => {
    const res = await request(app).get("/templates/tags").set("Authorization", `Bearer ${manageToken}`);
    expect(res.status).toBe(200);
    expect(res.body.tags.some((t: { tag: string }) => t.tag === "{{doc.link}}")).toBe(true);
  });

  it("CRUD: create → update → delete", async () => {
    const create = await request(app).post("/templates").set("Authorization", `Bearer ${manageToken}`)
      .send({ key: "unit_test", name: "Unit", category: "Test", subjectTemplate: "Hi {{recipient.name}}", htmlBodyTemplate: "<p>{{doc.link}}</p>" });
    expect(create.status).toBe(201);
    const id = create.body.id;

    const patch = await request(app).patch(`/templates/${id}`).set("Authorization", `Bearer ${manageToken}`).send({ name: "Renamed", enabled: false });
    expect(patch.status).toBe(200);
    const row = await knex("email_templates").where({ id }).first();
    expect(row.name).toBe("Renamed");
    expect(Boolean(row.enabled)).toBe(false);

    const del = await request(app).delete(`/templates/${id}`).set("Authorization", `Bearer ${manageToken}`);
    expect(del.status).toBe(200);
  });

  it("rejects a duplicate key with 409", async () => {
    await request(app).post("/templates").set("Authorization", `Bearer ${manageToken}`)
      .send({ key: "dupe", name: "A", subjectTemplate: "s", htmlBodyTemplate: "<p>x</p>" });
    const second = await request(app).post("/templates").set("Authorization", `Bearer ${manageToken}`)
      .send({ key: "dupe", name: "B", subjectTemplate: "s", htmlBodyTemplate: "<p>x</p>" });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("key_taken");
  });

  it("validates the body (400 when subject/html missing)", async () => {
    const res = await request(app).post("/templates").set("Authorization", `Bearer ${manageToken}`).send({ key: "bad", name: "x" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("enforces a lowercase-slug key", async () => {
    const res = await request(app).post("/templates").set("Authorization", `Bearer ${manageToken}`)
      .send({ key: "Bad Key!", name: "x", subjectTemplate: "s", htmlBodyTemplate: "<p>x</p>" });
    expect(res.status).toBe(400);
  });

  it("previews a template, expanding {{doc.link}} to an absolute deep-link", async () => {
    const tpl = await knex("email_templates").where({ key: "kyc_expiry" }).first();
    const res = await request(app).post(`/templates/${tpl.id}/preview`).set("Authorization", `Bearer ${manageToken}`).send({});
    expect(res.status).toBe(200);
    expect(res.body.rendered.subject).toContain("expiring");
    expect(res.body.rendered.html).toContain("https://dms.example.com/viewer?doc=");
  });

  it("test-send renders and dispatches an HTML email via the registry", async () => {
    const before = emailAdapter.sent.length;
    const tpl = await knex("email_templates").where({ key: "kyc_expiry" }).first();
    const res = await request(app).post(`/templates/${tpl.id}/test-send`).set("Authorization", `Bearer ${manageToken}`)
      .send({ to: "pema@zorfinotech.com" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.sentTo).toBe("pema@zorfinotech.com");
    expect(emailAdapter.sent.length).toBe(before + 1);
    expect(emailAdapter.sent.at(-1)?.recipient).toBe("pema@zorfinotech.com");
  });

  it("forbids mutations without email_template:manage", async () => {
    const res = await request(app).post("/templates").set("Authorization", `Bearer ${readonlyToken}`)
      .send({ key: "nope", name: "x", subjectTemplate: "s", htmlBodyTemplate: "<p>x</p>" });
    expect(res.status).toBe(403);
  });

  it("allows read-only listing with email_template:read", async () => {
    const res = await request(app).get("/templates").set("Authorization", `Bearer ${readonlyToken}`);
    expect(res.status).toBe(200);
  });
});
