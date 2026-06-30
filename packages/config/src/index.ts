export {
  fetchVaultSecrets,
  resolveEnvWithVault,
  vaultConfigFromEnv,
  type VaultConfig,
} from "./vault.js";

export type DbClient = "pg" | "oracledb" | "sqlite3";

export interface AppConfig {
  db: {
    client: DbClient;
    host: string;
    port: number;
    user: string;
    password: string;
    name: string;
    oracleConnectString: string;
  };
  jwtSecret: string;
  sessionSecret: string;
  gatewayPort: number;
  internalServiceToken: string;
  corsOrigin: string;
  ops: { drPrimarySite: string; drSite: string; rpoMinutes: number; rtoMinutes: number; replicationLagSeconds: number };
  search: { backend: "sql" | "elasticsearch"; esNode: string; esIndex: string };
}

const VALID: DbClient[] = ["pg", "oracledb", "sqlite3"];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const client = (env.DB_CLIENT ?? "pg") as DbClient;
  if (!VALID.includes(client)) {
    throw new Error(`Invalid DB_CLIENT "${client}". Expected one of ${VALID.join(", ")}`);
  }
  return {
    db: {
      client,
      host: env.DB_HOST ?? "localhost",
      port: Number(env.DB_PORT ?? 5432),
      user: env.DB_USER ?? "zordms",
      password: env.DB_PASSWORD ?? "zordms",
      name: env.DB_NAME ?? "zordms",
      oracleConnectString: env.DB_ORACLE_CONNECT_STRING ?? "",
    },
    jwtSecret: env.JWT_SECRET ?? "change-me-in-prod",
    sessionSecret: env.SESSION_SECRET ?? "change-me-in-prod",
    gatewayPort: Number(env.GATEWAY_PORT ?? 4000),
    internalServiceToken: env.INTERNAL_SERVICE_TOKEN ?? "change-me-internal",
    corsOrigin: env.CORS_ORIGIN ?? "http://localhost:5174",
    ops: {
      drPrimarySite: env.DR_PRIMARY_SITE ?? "Thimphu DC",
      drSite: env.DR_SITE ?? "DR Site (Phuentsholing)",
      rpoMinutes: Number(env.RPO_MINUTES ?? 15),
      rtoMinutes: Number(env.RTO_MINUTES ?? 60),
      replicationLagSeconds: Number(env.REPLICATION_LAG_SECONDS ?? 5),
    },
    search: {
      // SEARCH_BACKEND: "sql" (default) | "elasticsearch" (alias: "es").
      backend: (env.SEARCH_BACKEND ?? "sql") as "sql" | "elasticsearch",
      // ELASTICSEARCH_NODE is the canonical key; ES_NODE kept as a legacy alias.
      esNode: env.ELASTICSEARCH_NODE ?? env.ES_NODE ?? "http://localhost:9200",
      esIndex: env.ELASTICSEARCH_INDEX ?? env.ES_INDEX ?? "zordms-documents",
    },
  };
}
