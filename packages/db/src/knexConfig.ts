import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";
import { readdir } from "fs/promises";
import path from "path";

type DbCfg = AppConfig["db"];

// Custom migration source that loads .ts and .js files but excludes test files
const migrationsDir = new URL("./migrations", import.meta.url).pathname;
const migrationSource: Knex.MigrationSource<string> = {
  async getMigrations(): Promise<string[]> {
    const files = await readdir(migrationsDir);
    return files
      .filter((f) => {
        // Only include .ts or .js files, exclude test files
        const ext = path.extname(f);
        if (![".ts", ".js"].includes(ext)) return false;
        const base = path.basename(f, ext);
        return !base.endsWith(".test") && !base.endsWith(".spec");
      })
      .sort();
  },
  getMigrationName(migration: string): string {
    return migration;
  },
  async getMigration(migration: string): Promise<Knex.Migration> {
    const filePath = path.join(migrationsDir, migration);
    const mod = await import(filePath);
    return mod;
  },
};

export function buildKnexConfig(db: DbCfg): Knex.Config {
  const migrations = {
    migrationSource,
  };
  const seeds = {
    directory: new URL("./seeds", import.meta.url).pathname,
    loadExtensions: [".ts", ".js"],
  };

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
