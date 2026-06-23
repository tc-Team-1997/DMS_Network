import knexLib, { type Knex } from "knex";
import { loadConfig, type AppConfig } from "@zordms/config";
import { buildKnexConfig } from "./knexConfig.js";
import { readdir } from "fs/promises";
import path from "path";

/** Filter helper matching knexConfig.ts: exclude .d.ts/.d.js, test files, and dedup (prefer .ts). */
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

function buildMigrationSource(migrationsDir: string): Knex.MigrationSource<string> {
  return {
    async getMigrations(): Promise<string[]> {
      try {
        const files = await readdir(migrationsDir);
        return filterAndDedup(files);
      } catch {
        return [];
      }
    },
    getMigrationName(migration: string): string {
      return path.basename(migration, path.extname(migration));
    },
    async getMigration(migration: string): Promise<Knex.Migration> {
      const filePath = path.join(migrationsDir, migration);
      const mod = await import(filePath);
      return mod;
    },
  };
}

function buildSeedSource(seedsDir: string): Knex.SeedSource<string> {
  return {
    async getSeeds(config: Knex.SeederConfig): Promise<string[]> {
      try {
        const files = await readdir(seedsDir);
        const all = filterAndDedup(files).map((f) => path.join(seedsDir, f));
        if (config.specific) {
          return all.filter(
            (f) =>
              path.basename(f) === config.specific ||
              path.basename(f, path.extname(f)) === config.specific
          );
        }
        return all;
      } catch {
        return [];
      }
    },
    async getSeed(filepath: string): Promise<Knex.Seed> {
      const mod = await import(filepath);
      return mod;
    },
  };
}

/**
 * Build a Knex instance using the same DB connection as @zordms/db getKnex(),
 * but with per-service migrations and seeds directories.
 * Pass `db` to override the connection config (e.g. for tests using sqlite3).
 */
export function buildServiceKnex(opts: {
  migrationsDir: string;
  seedsDir?: string;
  db?: AppConfig["db"];
}): Knex {
  const db = opts.db ?? loadConfig().db;
  const base = buildKnexConfig(db);
  return knexLib({
    ...base,
    migrations: {
      migrationSource: buildMigrationSource(opts.migrationsDir),
    },
    seeds: opts.seedsDir
      ? { seedSource: buildSeedSource(opts.seedsDir) }
      : base.seeds,
  });
}
