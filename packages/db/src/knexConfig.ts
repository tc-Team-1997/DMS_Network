import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";

type DbCfg = AppConfig["db"];

export function buildKnexConfig(db: DbCfg): Knex.Config {
  const migrations = { directory: new URL("./migrations", import.meta.url).pathname, extension: "js" };
  const seeds = { directory: new URL("./seeds", import.meta.url).pathname };

  if (db.client === "oracledb") {
    return {
      client: "oracledb",
      connection: { user: db.user, password: db.password, connectString: db.oracleConnectString },
      pool: { min: 2, max: 10 },
      migrations, seeds,
    };
  }
  if (db.client === "sqlite3") {
    return {
      client: "sqlite3",
      connection: { filename: process.env.SQLITE_FILE ?? ":memory:" },
      useNullAsDefault: true,
      pool: { min: 1, max: 1 },
      migrations, seeds,
    };
  }
  return {
    client: "pg",
    connection: { host: db.host, port: db.port, user: db.user, password: db.password, database: db.name },
    pool: { min: 2, max: 10 },
    migrations, seeds,
  };
}
