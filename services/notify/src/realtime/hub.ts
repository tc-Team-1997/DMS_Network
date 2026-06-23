import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";

export interface SocketLike { send(data: string): void; readyState?: number; }
const OPEN = 1;

export class RealtimeHub {
  private readonly clients = new Set<SocketLike>();

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
    wss.on("connection", (socket: WebSocket) => {
      this.add(socket);
      socket.on("close", () => this.remove(socket));
    });
  }
}
