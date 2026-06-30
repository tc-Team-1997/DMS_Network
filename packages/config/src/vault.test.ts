import { describe, it, expect } from "vitest";
import { fetchVaultSecrets, resolveEnvWithVault, vaultConfigFromEnv } from "./vault.js";

/** Build a fake fetch returning a Vault KV v2 envelope, recording the request. */
function fakeFetch(opts: {
  ok?: boolean;
  status?: number;
  data?: Record<string, unknown>;
  throws?: boolean;
}) {
  const calls: Array<{ url: string; headers?: Record<string, string> }> = [];
  const impl = async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, headers: init?.headers });
    if (opts.throws) throw new Error("ECONNREFUSED");
    return {
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      json: async () => ({ data: { data: opts.data ?? {} } }),
    };
  };
  return { impl, calls };
}

describe("vaultConfigFromEnv", () => {
  it("reads addr/token and defaults mount + path", () => {
    const cfg = vaultConfigFromEnv({ VAULT_ADDR: "https://vault:8200", VAULT_TOKEN: "t" } as NodeJS.ProcessEnv);
    expect(cfg.addr).toBe("https://vault:8200");
    expect(cfg.token).toBe("t");
    expect(cfg.mount).toBe("secret");
    expect(cfg.path).toBe("zordms");
  });
});

describe("fetchVaultSecrets", () => {
  it("returns {} when Vault is not configured (no fetch attempted)", async () => {
    const { impl, calls } = fakeFetch({ data: { JWT_SECRET: "x" } });
    const out = await fetchVaultSecrets({}, impl);
    expect(out).toEqual({});
    expect(calls).toHaveLength(0);
  });

  it("fetches the KV v2 path with the token header and flattens data to strings", async () => {
    const { impl, calls } = fakeFetch({ data: { JWT_SECRET: "s3cr3t", DB_PORT: 5432, FLAG: true } });
    const out = await fetchVaultSecrets(
      { addr: "https://vault:8200/", token: "tok", mount: "kv", path: "core" },
      impl,
    );
    expect(out).toEqual({ JWT_SECRET: "s3cr3t", DB_PORT: "5432", FLAG: "true" });
    expect(calls[0].url).toBe("https://vault:8200/v1/kv/data/core"); // trailing slash trimmed
    expect(calls[0].headers?.["X-Vault-Token"]).toBe("tok");
  });

  it("returns {} on a non-OK response (e.g. 403) without throwing", async () => {
    const { impl } = fakeFetch({ ok: false, status: 403 });
    expect(await fetchVaultSecrets({ addr: "https://v", token: "t" }, impl)).toEqual({});
  });

  it("returns {} when the fetch throws (Vault unreachable)", async () => {
    const { impl } = fakeFetch({ throws: true });
    expect(await fetchVaultSecrets({ addr: "https://v", token: "t" }, impl)).toEqual({});
  });
});

describe("resolveEnvWithVault", () => {
  it("overlays Vault secrets on top of the base env", async () => {
    const { impl } = fakeFetch({ data: { JWT_SECRET: "from-vault" } });
    const base = { VAULT_ADDR: "https://v", VAULT_TOKEN: "t", JWT_SECRET: "from-env", OTHER: "keep" } as NodeJS.ProcessEnv;
    const merged = await resolveEnvWithVault(base, impl);
    expect(merged.JWT_SECRET).toBe("from-vault"); // Vault wins
    expect(merged.OTHER).toBe("keep");            // env preserved
  });

  it("returns the base env unchanged when Vault yields nothing", async () => {
    const { impl } = fakeFetch({ data: {} });
    const base = { VAULT_ADDR: "https://v", VAULT_TOKEN: "t", JWT_SECRET: "from-env" } as NodeJS.ProcessEnv;
    const merged = await resolveEnvWithVault(base, impl);
    expect(merged).toBe(base); // same reference — no overlay built
  });

  it("returns the base env when Vault is disabled", async () => {
    const base = { JWT_SECRET: "from-env" } as NodeJS.ProcessEnv;
    const merged = await resolveEnvWithVault(base);
    expect(merged).toBe(base);
  });
});
