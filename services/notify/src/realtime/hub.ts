import type { Server, IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { verifyToken } from "@zordms/auth";

export interface SocketLike { send(data: string): void; readyState?: number; }
const OPEN = 1;

export class RealtimeHub {
  private readonly clients = new Set<SocketLike>();
  private jwtSecret = "";

  setJwtSecret(secret: string): void { this.jwtSecret = secret; }

  add(client: SocketLike): void { this.clients.add(client); }
  remove(client: SocketLike): void { this.clients.delete(client); }
  get size(): number { return this.clients.size; }

  broadcast(payload: unknown): void {
    const data = JSON.stringify(payload);
    for (const c of this.clients) {
      if (c.readyState === undefined || c.readyState === OPEN) c.send(data);
    }
  }

  attach(server: Server): void {
    const wss = new WebSocketServer({ server, path: "/ws/alerts" });
    wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
      // Authenticate via ?token= query param; close with 4401 if missing/invalid
      const url = new URL(req.url ?? "", "http://localhost");
      const token = url.searchParams.get("token") ?? "";
      if (!token || !this.jwtSecret) {
        socket.close(4401, "unauthorized");
        return;
      }
      try {
        verifyToken(token, this.jwtSecret);
      } catch {
        socket.close(4401, "unauthorized");
        return;
      }
      this.add(socket);
      socket.on("close", () => this.remove(socket));
    });
  }
}
