/**
 * Optional HashiCorp Vault secrets provider.
 *
 * When VAULT_ADDR + VAULT_TOKEN are set, secrets are read from a KV v2 path and
 * overlaid on top of process.env (so a leaked secret can be rotated in Vault
 * without redeploying). Any failure — Vault disabled, unreachable, 403, missing
 * path — degrades to plain env rather than crashing boot, mirroring the S3 and
 * Kafka providers. `fetch` is injectable so tests need no live Vault.
 */

type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface VaultConfig {
  addr?: string;
  token?: string;
  /** KV v2 mount point (default "secret"). */
  mount?: string;
  /** Secret path under the mount (default "zordms"). */
  path?: string;
}

export function vaultConfigFromEnv(env: NodeJS.ProcessEnv): VaultConfig {
  return {
    addr: env.VAULT_ADDR,
    token: env.VAULT_TOKEN,
    mount: env.VAULT_KV_MOUNT ?? "secret",
    path: env.VAULT_SECRET_PATH ?? "zordms",
  };
}

/**
 * Fetch the flat key→value secret map from Vault KV v2. Returns {} when Vault
 * isn't configured or anything goes wrong (never throws).
 */
export async function fetchVaultSecrets(
  cfg: VaultConfig,
  fetchImpl?: FetchLike,
): Promise<Record<string, string>> {
  if (!cfg.addr || !cfg.token) return {};
  const doFetch = (fetchImpl ?? (globalThis.fetch as unknown as FetchLike)) || undefined;
  if (!doFetch) return {};

  const base = cfg.addr.replace(/\/+$/, "");
  const mount = cfg.mount ?? "secret";
  const path = cfg.path ?? "zordms";
  const url = `${base}/v1/${mount}/data/${path}`;
  try {
    const res = await doFetch(url, { method: "GET", headers: { "X-Vault-Token": cfg.token } });
    if (!res.ok) return {};
    const body = (await res.json()) as { data?: { data?: Record<string, unknown> } };
    const data = body?.data?.data;
    if (!data || typeof data !== "object") return {};
    // Coerce every value to string so it merges cleanly into an env overlay.
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v != null) out[k] = String(v);
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Resolve an effective env: Vault secrets overlaid on the base env. Pass the
 * result to loadConfig(). With Vault unset/unreachable this is just `baseEnv`.
 */
export async function resolveEnvWithVault(
  baseEnv: NodeJS.ProcessEnv = process.env,
  fetchImpl?: FetchLike,
): Promise<NodeJS.ProcessEnv> {
  const secrets = await fetchVaultSecrets(vaultConfigFromEnv(baseEnv), fetchImpl);
  if (Object.keys(secrets).length === 0) return baseEnv;
  return { ...baseEnv, ...secrets };
}
