import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import knexLib from "knex";
import { buildKnexConfig, newId } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { hashPassword } from "@zordms/auth";
import { createApp } from "../app.js";
import { loadAuthConfig, type AuthConfig } from "./authConfig.js";
import type { SsoClients } from "./clients.js";
import type { ExternalIdentity } from "./jit.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));
const config = loadConfig({ JWT_SECRET: "test-secret" } as NodeJS.ProcessEnv);

// Disabled-by-default auth config (all flags false).
function baseAuthConfig(): AuthConfig {
  return loadAuthConfig({} as NodeJS.ProcessEnv);
}

// Mock SSO clients — no network. Identity is injected per-test.
function fakeClients(identity: ExternalIdentity | null): SsoClients {
  return {
    ldap: {
      async authenticate() { return identity; },
    },
    oidc: {
      async buildAuthRequest() {
        return { authorizationUrl: "https://idp.example/authorize?x=1", state: "st", nonce: "no", codeVerifier: "cv" };
      },
      async exchange() {
        if (!identity) throw new Error("no identity");
        return identity;
      },
    },
    saml: {
      async buildLoginUrl() { return "https://idp.example/sso?SAMLRequest=abc"; },
      async validatePostResponse() {
        if (!identity) throw new Error("no identity");
        return identity;
      },
    },
  };
}

// Rebuild the app with a given auth config + mock clients.
function appWith(authConfig: AuthConfig, identity: ExternalIdentity | null = null) {
  return createApp({ knex, config, authConfig, ssoClients: fakeClients(identity) } as any);
}

// Decode the JWT payload (claims) without a jsonwebtoken dependency — the
// signature is exercised end-to-end by requireAuth elsewhere; here we only
// assert the embedded RBAC claims.
function decode(token: string): any {
  const payload = token.split(".")[1];
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

beforeAll(async () => { await knex.migrate.latest(); await knex.seed.run(); });
afterAll(async () => { await knex.destroy(); });

// Clean up any SSO-provisioned users between tests for isolation.
beforeEach(async () => {
  await knex("users").where("created_by", "like", "sso:%").del();
  await knex("users").whereIn("username", ["sso.staff", "newhire", "ldapuser", "oidcuser", "samluser"]).del();
});

describe("GET /auth/config", () => {
  it("reports local:true and NO providers when all SSO flags are off", async () => {
    const res = await request(appWith(baseAuthConfig())).get("/auth/config");
    expect(res.status).toBe(200);
    expect(res.body.local).toBe(true);
    expect(res.body.providers).toEqual([]);
  });

  it("lists only enabled providers with displayName + loginUrl", async () => {
    const ac = loadAuthConfig({
      AUTH_LDAP_ENABLED: "true", LDAP_DISPLAY_NAME: "Bank AD",
      AUTH_OIDC_ENABLED: "true", OIDC_DISPLAY_NAME: "Azure SSO",
      // SAML left disabled
    } as NodeJS.ProcessEnv);
    const res = await request(appWith(ac)).get("/auth/config");
    expect(res.status).toBe(200);
    const ids = res.body.providers.map((p: any) => p.id);
    expect(ids).toContain("ldap");
    expect(ids).toContain("oidc");
    expect(ids).not.toContain("saml");
    const ldap = res.body.providers.find((p: any) => p.id === "ldap");
    expect(ldap.displayName).toBe("Bank AD");
    expect(ldap.loginUrl).toBe("/auth/ldap/login");
  });
});

describe("provider disabled vs local login", () => {
  it("returns 404 provider_disabled for a disabled LDAP route", async () => {
    const res = await request(appWith(baseAuthConfig()))
      .post("/auth/ldap/login").send({ username: "x", password: "y" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("provider_disabled");
  });

  it("returns 404 provider_disabled for disabled OIDC + SAML routes", async () => {
    const app = appWith(baseAuthConfig());
    const oidc = await request(app).get("/auth/oidc/login");
    expect(oidc.status).toBe(404);
    expect(oidc.body.error).toBe("provider_disabled");
    const saml = await request(app).get("/auth/saml/login");
    expect(saml.status).toBe(404);
    expect(saml.body.error).toBe("provider_disabled");
  });

  it("local username/password login STILL issues a JWT when all SSO is disabled", async () => {
    const res = await request(appWith(baseAuthConfig()))
      .post("/auth/login").send({ username: "admin", password: "admin123" });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.permissions).toContain("user:create");
  });
});

describe("LDAP login", () => {
  it("maps a mocked successful bind to a local user and returns a JWT with the user's REAL roles", async () => {
    // Pre-create a local user with Supervisor role (NOT the default Viewer).
    const id = newId();
    await knex("users").insert({
      id, username: "ldapuser", password_hash: await hashPassword("unused"),
      email: "ldapuser@bobl.bt", status: "Active",
    });
    const supervisor = await knex("roles").where({ name: "Supervisor" }).first();
    await knex("user_roles").insert({ user_id: id, role_id: supervisor.id });

    const ac = loadAuthConfig({ AUTH_LDAP_ENABLED: "true" } as NodeJS.ProcessEnv);
    const identity: ExternalIdentity = { username: "ldapuser", email: "ldapuser@bobl.bt", displayName: "LDAP User" };
    const res = await request(appWith(ac, identity))
      .post("/auth/ldap/login").send({ username: "ldapuser", password: "anything" });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    const claims = decode(res.body.token);
    expect(claims.sub).toBe(id);
    expect(claims.roles).toContain("Supervisor");
    expect(claims.permissions).toContain("user:create");
    expect(res.body.user.roles).toContain("Supervisor");

    await knex("users").where({ id }).del();
  });

  it("returns 401 invalid_credentials when the mocked bind fails", async () => {
    const ac = loadAuthConfig({ AUTH_LDAP_ENABLED: "true" } as NodeJS.ProcessEnv);
    const res = await request(appWith(ac, null))
      .post("/auth/ldap/login").send({ username: "ldapuser", password: "bad" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_credentials");
  });

  it("JIT-provisions a new user on first external login with the default role", async () => {
    const ac = loadAuthConfig({ AUTH_LDAP_ENABLED: "true", SSO_DEFAULT_ROLE: "Viewer" } as NodeJS.ProcessEnv);
    const identity: ExternalIdentity = { username: "newhire", email: "newhire@bobl.bt", displayName: "New Hire" };

    const before = await knex("users").where({ username: "newhire" }).first();
    expect(before).toBeUndefined();

    const res = await request(appWith(ac, identity))
      .post("/auth/ldap/login").send({ username: "newhire", password: "pw" });
    expect(res.status).toBe(200);
    const claims = decode(res.body.token);
    expect(claims.roles).toEqual(["Viewer"]);
    expect(claims.permissions).toContain("document:read");

    const created = await knex("users").where({ username: "newhire" }).first();
    expect(created).toBeTruthy();
    expect(created.status).toBe("Active");
    expect(created.created_by).toBe("sso:ldap");
    // Provisioned SSO users cannot do a local password login (sentinel hash).
    expect(created.password_hash).toBe("!SSO-NOLOGIN");

    // Idempotent: a second login reuses the same user, no duplicate.
    const res2 = await request(appWith(ac, identity))
      .post("/auth/ldap/login").send({ username: "newhire", password: "pw" });
    expect(res2.status).toBe(200);
    const count = await knex("users").where({ username: "newhire" }).count<{ c: number }[]>("id as c");
    expect(Number(count[0].c)).toBe(1);
  });

  it("JIT-provisions with IdP-group-mapped roles when a group->role map is set", async () => {
    const ac = loadAuthConfig({
      AUTH_LDAP_ENABLED: "true",
      LDAP_GROUP_ROLE_MAP: JSON.stringify({ "CN=DMS-Admins": "Supervisor" }),
    } as NodeJS.ProcessEnv);
    const identity: ExternalIdentity = {
      username: "sso.staff", email: "sso.staff@bobl.bt", groups: ["CN=DMS-Admins"],
    };
    const res = await request(appWith(ac, identity))
      .post("/auth/ldap/login").send({ username: "sso.staff", password: "pw" });
    expect(res.status).toBe(200);
    const claims = decode(res.body.token);
    expect(claims.roles).toContain("Supervisor");
    expect(claims.roles).not.toContain("Viewer");
  });
});

describe("OIDC flow", () => {
  it("GET /auth/oidc/login redirects to the IdP authorization endpoint", async () => {
    const ac = loadAuthConfig({ AUTH_OIDC_ENABLED: "true" } as NodeJS.ProcessEnv);
    const res = await request(appWith(ac)).get("/auth/oidc/login");
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("https://idp.example/authorize");
  });

  it("login sets the signed HttpOnly oidc_tx transient cookie", async () => {
    const ac = loadAuthConfig({ AUTH_OIDC_ENABLED: "true" } as NodeJS.ProcessEnv);
    const res = await request(appWith(ac)).get("/auth/oidc/login");
    expect(res.status).toBe(302);
    const setCookie = (res.headers["set-cookie"] as unknown as string[]) ?? [];
    const tx = setCookie.find((c) => c.startsWith("oidc_tx="));
    expect(tx).toBeTruthy();
    expect(tx).toMatch(/HttpOnly/i);
    expect(tx).toMatch(/SameSite=Lax/i);
    expect(tx).toMatch(/Path=\/auth\/oidc/i);
  });

  it("callback with the carried cookie issues a JWT and hands it off to the web app", async () => {
    const ac = loadAuthConfig({
      AUTH_OIDC_ENABLED: "true", WEB_APP_URL: "https://dms.bobl.bt",
    } as NodeJS.ProcessEnv);
    const identity: ExternalIdentity = { email: "oidcuser@bobl.bt", username: "oidcuser", displayName: "OIDC User" };
    // A supertest *agent* persists Set-Cookie from /login into the /callback
    // request, simulating the same browser completing the IdP round-trip.
    const agent = request.agent(appWith(ac, identity));

    await agent.get("/auth/oidc/login");
    const res = await agent.get("/auth/oidc/callback").query({ code: "abc", state: "st" });

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/dms\.bobl\.bt\/login#token=/);
    const token = decodeURIComponent(res.headers.location.split("#token=")[1]);
    const claims = decode(token);
    expect(claims.username).toBe("oidcuser");

    const created = await knex("users").where({ username: "oidcuser" }).first();
    expect(created.created_by).toBe("sso:oidc");
    // Cookie is cleared on success.
    const setCookie = (res.headers["set-cookie"] as unknown as string[]) ?? [];
    expect(setCookie.some((c) => /^oidc_tx=;?/.test(c))).toBe(true);
  });

  it("callback with NO cookie is rejected 400 (simulates a different replica with no shared memory)", async () => {
    const ac = loadAuthConfig({ AUTH_OIDC_ENABLED: "true" } as NodeJS.ProcessEnv);
    const identity: ExternalIdentity = { email: "oidcuser@bobl.bt", username: "oidcuser" };
    // Fresh request (no agent) -> the Set-Cookie from /login never travels.
    // Under the old in-memory Map this "worked" by luck on a single node; the
    // cookie design now correctly rejects it.
    const res = await request(appWith(ac, identity))
      .get("/auth/oidc/callback").query({ code: "abc", state: "st" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_state");
  });

  it("callback rejects an unknown/forged state even when a valid cookie is present", async () => {
    const ac = loadAuthConfig({ AUTH_OIDC_ENABLED: "true" } as NodeJS.ProcessEnv);
    const agent = request.agent(appWith(ac, { email: "x@bobl.bt" }));
    await agent.get("/auth/oidc/login"); // mints cookie for state "st"
    const res = await agent.get("/auth/oidc/callback").query({ code: "abc", state: "forged" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_state");
  });
});

describe("SAML flow", () => {
  it("GET /auth/saml/login redirects to the IdP SSO endpoint", async () => {
    const ac = loadAuthConfig({ AUTH_SAML_ENABLED: "true" } as NodeJS.ProcessEnv);
    const res = await request(appWith(ac)).get("/auth/saml/login");
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("https://idp.example/sso");
  });

  it("ACS callback with a mocked verified assertion issues a JWT and hands it off", async () => {
    const ac = loadAuthConfig({
      AUTH_SAML_ENABLED: "true", WEB_APP_URL: "https://dms.bobl.bt",
    } as NodeJS.ProcessEnv);
    const identity: ExternalIdentity = { email: "samluser@bobl.bt", username: "samluser", displayName: "SAML User" };
    const res = await request(appWith(ac, identity))
      .post("/auth/saml/callback")
      .type("form")
      .send({ SAMLResponse: "base64assertion" });

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/dms\.bobl\.bt\/login#token=/);
    const token = decodeURIComponent(res.headers.location.split("#token=")[1]);
    const claims = decode(token);
    expect(claims.username).toBe("samluser");

    const created = await knex("users").where({ username: "samluser" }).first();
    expect(created.created_by).toBe("sso:saml");
  });
});
