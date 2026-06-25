import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { buildServiceKnex } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { signToken } from "@zordms/auth";
import { createApp } from "../app.js";
import { createRecordingBus } from "../events.js";

const migrationsDir = new URL("../migrations", import.meta.url).pathname;
const db = {
  client: "sqlite3" as const,
  host: "",
  port: 0,
  user: "",
  password: "",
  name: "",
  oracleConnectString: "",
};
const knex = buildServiceKnex({ migrationsDir, db });
const events = createRecordingBus();
const config = loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv);
const app = createApp({ knex, config, events });

const actorToken = signToken(
  {
    sub: "01910000-0000-7000-0000-0000000000aa",
    username: "maker_v",
    permissions: ["workflow:act"],
  } as Parameters<typeof signToken>[0],
  "t",
);

beforeAll(async () => {
  await knex.migrate.latest();
});
afterAll(async () => {
  await knex.destroy();
});

describe("P10 zod boundary validation", () => {
  it("POST /templates with a missing name returns 400 validation_error", async () => {
    const res = await request(app)
      .post("/templates")
      .set("Authorization", `Bearer ${actorToken}`)
      .send({ steps_json: JSON.stringify([{ name: "S" }]) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(res.body.issues.length).toBeGreaterThan(0);
  });

  it("POST /workflows with a missing template_id returns 400 validation_error", async () => {
    const res = await request(app)
      .post("/workflows")
      .set("Authorization", `Bearer ${actorToken}`)
      .send({ title: "No template" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("POST /workflows/:id/act with an unknown action returns 400 validation_error", async () => {
    const res = await request(app)
      .post("/workflows/some-id/act")
      .set("Authorization", `Bearer ${actorToken}`)
      .send({ action: "bogus_action" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("GET /workflows with an unknown status returns 400 validation_error", async () => {
    const res = await request(app)
      .get("/workflows?status=Bogus")
      .set("Authorization", `Bearer ${actorToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });
});

describe("P10 OpenAPI document", () => {
  it("GET /openapi.json returns a 3.1 spec with the expected paths", async () => {
    const res = await request(app).get("/openapi.json");
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe("3.1.0");
    const paths = Object.keys(res.body.paths);
    expect(paths).toContain("/templates");
    expect(paths).toContain("/workflows");
    expect(paths).toContain("/workflows/{id}/claim");
    expect(paths).toContain("/workflows/{id}/act");
    // auth scheme present: bearer JWT + internal token
    expect(res.body.components.securitySchemes.bearerAuth.scheme).toBe("bearer");
    expect(res.body.components.securitySchemes.internalToken.name).toBe(
      "x-internal-token",
    );
  });

  it("GET /openapi serves the same raw spec", async () => {
    const res = await request(app).get("/openapi");
    expect(res.status).toBe(200);
    expect(res.body.info.title).toContain("Workflow");
  });
});
