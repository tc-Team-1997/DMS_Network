import { describe, it, expect } from "vitest";
import { loadConfig } from "./index.js";

describe("loadConfig", () => {
  it("defaults DB client to pg and parses port as number", () => {
    const cfg = loadConfig({ DB_PORT: "5432" } as NodeJS.ProcessEnv);
    expect(cfg.db.client).toBe("pg");
    expect(cfg.db.port).toBe(5432);
    expect(typeof cfg.gatewayPort).toBe("number");
  });

  it("honors oracledb selection and connect string", () => {
    const cfg = loadConfig({ DB_CLIENT: "oracledb", DB_ORACLE_CONNECT_STRING: "h:1521/PDB" } as NodeJS.ProcessEnv);
    expect(cfg.db.client).toBe("oracledb");
    expect(cfg.db.oracleConnectString).toBe("h:1521/PDB");
  });

  it("rejects an unknown DB client", () => {
    expect(() => loadConfig({ DB_CLIENT: "mysql" } as NodeJS.ProcessEnv)).toThrow(/DB_CLIENT/);
  });
});
