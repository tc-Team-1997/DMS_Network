import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";
import { readdir } from "fs/promises";
import path from "path";

type DbCfg = AppConfig["db"];

/** Filter helper: exclude .d.ts/.d.js, test files, and deduplicate (prefer .ts over .js). */
function filterAndDedup(files: string[]): string[] {
  return files
    .filter((f) => {
      if (f.endsWith(".d.ts") || f.endsWith(".d.js")) return false;
      const ext = path.extname(f);
      if (![".ts", ".js"].includes(ext)) return false;
      const base = path.basename(f, ext);
      return !base.endsWith(".test") && !base.endsWith(".spec");
    })
    .sort()
    .reduce<string[]>((acc, f) => {
      const ext = path.extname(f);
      const base = path.basename(f, ext);
      const alreadyHasTs = acc.some(
        (x) => path.basename(x, path.extname(x)) === base && x.endsWith(".ts")
      );
      if (ext === ".js" && alreadyHasTs) return acc;
      const jsIdx = acc.findIndex(
        (x) => path.basename(x, path.extname(x)) === base && x.endsWith(".js")
      );
      if (ext === ".ts" && jsIdx !== -1) {
        acc[jsIdx] = f;
        return acc;
      }
      acc.push(f);
      return acc;
    }, []);
}

// Custom migration source that loads .ts and .js files but excludes test files and .d.ts
const migrationsDir = new URL("./migrations", import.meta.url).pathname;
const migrationSource: Knex.MigrationSource<string> = {
  async getMigrations(): Promise<string[]> {
    const files = await readdir(migrationsDir);
    return filterAndDedup(files);
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

// Custom seed source that loads .ts and .js files but excludes test files and .d.ts
const seedsDir = new URL("./seeds", import.meta.url).pathname;
const seedSource = {
  async getSeeds(): Promise<string[]> {
    const files = await readdir(seedsDir);
    return filterAndDedup(files).map((f) => path.join(seedsDir, f));
  },
  async getSeed(filepath: string): Promise<Knex.Seed> {
    const mod = await import(filepath);
    return mod;
  },
};

export function buildKnexConfig(db: DbCfg): Knex.Config {
  const migrations = {
    migrationSource,
  };
  // Use seedSource (no directory) so knex doesn't override our source
  const seeds = {
    seedSource,
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
