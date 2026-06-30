import { describe, it, expect, vi } from "vitest";
import { SftpConnector, type SftpClientLike } from "./sftp.js";

function fakeClient(overrides: Partial<SftpClientLike> = {}) {
  return {
    connect: vi.fn(async () => undefined),
    put: vi.fn(async () => "ok"),
    list: vi.fn(async () => []),
    end: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("SftpConnector", () => {
  it("report.submit connects, puts the file, and ends the session", async () => {
    const client = fakeClient();
    const c = new SftpConnector("rma", { host: "sftp.rma.gov.bt", port: 22, username: "u", password: "p" }, () => client);

    const res = await c.call("report.submit", { filename: "RMA-Q2.xlsx", content: "col1,col2\n1,2" });

    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect((res.data as any).remotePath).toBe("/incoming/RMA-Q2.xlsx");
    expect((res.data as any).bytes).toBeGreaterThan(0);
    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.put).toHaveBeenCalledOnce();
    expect(client.end).toHaveBeenCalledOnce(); // session always closed
  });

  it("ping lists the remote dir", async () => {
    const client = fakeClient();
    const c = new SftpConnector("rma", { host: "h" }, () => client);
    const res = await c.call("ping", {});
    expect(res.ok).toBe(true);
    expect((res.data as any).reachable).toBe(true);
    expect(client.list).toHaveBeenCalledOnce();
  });

  it("returns 502 and still closes when the upstream errors", async () => {
    const client = fakeClient({ put: vi.fn(async () => { throw new Error("connection refused"); }) });
    const c = new SftpConnector("rma", { host: "h" }, () => client);
    const res = await c.call("report.submit", { filename: "x.dat", content: "x" });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(502);
    expect(res.error).toContain("connection refused");
    expect(client.end).toHaveBeenCalledOnce();
  });

  it("rejects an unsupported op", async () => {
    const client = fakeClient();
    const c = new SftpConnector("rma", { host: "h" }, () => client);
    const res = await c.call("delete.everything", {});
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
  });
});
