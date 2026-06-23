import { describe, it, expect } from "vitest";
import { buildKnexConfig } from "./knexConfig.js";

const base = { host: "h", port: 5432, user: "u", password: "p", name: "n", oracleConnectString: "h:1521/PDB" };

describe("buildKnexConfig", () => {
  it("maps pg to a host/port connection", () => {
    const c = buildKnexConfig({ ...base, client: "pg" });
    expect(c.client).toBe("pg");
    expect((c.connection as any).host).toBe("h");
    expect((c.connection as any).database).toBe("n");
  });

  it("maps oracledb to a connectString connection", () => {
    const c = buildKnexConfig({ ...base, client: "oracledb" });
    expect(c.client).toBe("oracledb");
    expect((c.connection as any).connectString).toBe("h:1521/PDB");
    expect((c.connection as any).user).toBe("u");
  });

  it("maps sqlite3 to a file connection with useNullAsDefault", () => {
    const c = buildKnexConfig({ ...base, client: "sqlite3" });
    expect(c.client).toBe("sqlite3");
    expect(c.useNullAsDefault).toBe(true);
  });
});
