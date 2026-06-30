import type { Connector } from "./types.js";
import type { ConnectorResult } from "@zordms/types";

/**
 * SFTP connector — used for systems whose live transport is SFTP rather than
 * REST (e.g. RMA regulatory-report submission). Implements the same Connector
 * interface as the HTTP/mock connectors so it slots into selectConnector +
 * withLogging + the /systems/:system/call endpoint unchanged.
 *
 * The ssh2-sftp-client is lazy-imported and the client is injectable, so unit
 * tests run without a real SFTP server (mirrors how notify mocks Twilio).
 */
export interface SftpCreds {
  host: string;
  port?: number;
  username?: string;
  password?: string;
}

/** Minimal slice of ssh2-sftp-client we depend on (keeps tests mockable). */
export interface SftpClientLike {
  connect(opts: Record<string, unknown>): Promise<unknown>;
  put(input: Buffer | string, remotePath: string): Promise<string>;
  list(remotePath: string): Promise<unknown[]>;
  end(): Promise<void>;
}

export type SftpClientFactory = () => Promise<SftpClientLike> | SftpClientLike;

async function defaultClientFactory(): Promise<SftpClientLike> {
  const mod: any = await import("ssh2-sftp-client");
  const Client = mod.default ?? mod;
  return new Client() as SftpClientLike;
}

export class SftpConnector implements Connector {
  constructor(
    public readonly system: string,
    private readonly creds: SftpCreds,
    private readonly clientFactory: SftpClientFactory = defaultClientFactory,
  ) {}

  async call<T = unknown>(op: string, payload: unknown): Promise<ConnectorResult<T>> {
    const p = (payload ?? {}) as Record<string, unknown>;
    const client = await this.clientFactory();
    try {
      await client.connect({
        host: this.creds.host,
        port: this.creds.port ?? 22,
        username: this.creds.username,
        password: this.creds.password,
      });

      if (op === "report.submit") {
        const filename = String(p.filename ?? "report.dat");
        const remotePath = String(p.remotePath ?? `/incoming/${filename}`);
        const content =
          typeof p.content === "string" ? Buffer.from(p.content, "utf8") : Buffer.from(String(p.content ?? ""));
        await client.put(content, remotePath);
        return { ok: true, status: 200, data: { remotePath, bytes: content.length } } as ConnectorResult<T>;
      }

      if (op === "ping") {
        await client.list(String(p.remotePath ?? "/"));
        return { ok: true, status: 200, data: { reachable: true } } as ConnectorResult<T>;
      }

      return { ok: false, status: 400, error: `unsupported_sftp_op:${op}` } as ConnectorResult<T>;
    } catch (err) {
      return { ok: false, status: 502, error: (err as Error).message } as ConnectorResult<T>;
    } finally {
      try {
        await client.end();
      } catch {
        /* best-effort close */
      }
    }
  }
}
