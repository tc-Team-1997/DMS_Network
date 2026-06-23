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
  };
}
