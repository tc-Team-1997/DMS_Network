import { describe, it, expect } from "vitest";
import { loadAuthConfig, enabledProviders } from "./authConfig.js";

describe("loadAuthConfig", () => {
  it("disables every provider by default (SSO is purely additive)", () => {
    const ac = loadAuthConfig({} as NodeJS.ProcessEnv);
    expect(ac.ldap.enabled).toBe(false);
    expect(ac.oidc.enabled).toBe(false);
    expect(ac.saml.enabled).toBe(false);
    expect(enabledProviders(ac)).toEqual([]);
  });

  it("treats only the exact string \"true\" as enabled", () => {
    expect(loadAuthConfig({ AUTH_LDAP_ENABLED: "1" } as NodeJS.ProcessEnv).ldap.enabled).toBe(false);
    expect(loadAuthConfig({ AUTH_LDAP_ENABLED: "TRUE" } as NodeJS.ProcessEnv).ldap.enabled).toBe(false);
    expect(loadAuthConfig({ AUTH_LDAP_ENABLED: "true" } as NodeJS.ProcessEnv).ldap.enabled).toBe(true);
  });

  it("defaults the LDAP search filter and SSO default role", () => {
    const ac = loadAuthConfig({} as NodeJS.ProcessEnv);
    expect(ac.ldap.searchFilter).toBe("(sAMAccountName={{username}})");
    expect(ac.oidc.scopes).toBe("openid email profile");
    expect(ac.ssoDefaultRole).toBe("Viewer");
  });

  it("parses a valid group->role JSON map and ignores malformed JSON", () => {
    const good = loadAuthConfig({ LDAP_GROUP_ROLE_MAP: '{"CN=Admins":"Supervisor"}' } as NodeJS.ProcessEnv);
    expect(good.ldap.groupRoleMap).toEqual({ "CN=Admins": "Supervisor" });
    const bad = loadAuthConfig({ LDAP_GROUP_ROLE_MAP: "{not json" } as NodeJS.ProcessEnv);
    expect(bad.ldap.groupRoleMap).toEqual({});
  });

  it("emits descriptors with stable loginUrls for enabled providers only", () => {
    const ac = loadAuthConfig({ AUTH_SAML_ENABLED: "true", SAML_DISPLAY_NAME: "Bank IdP" } as NodeJS.ProcessEnv);
    const list = enabledProviders(ac);
    expect(list).toEqual([
      { id: "saml", enabled: true, displayName: "Bank IdP", loginUrl: "/auth/saml/login" },
    ]);
  });
});
