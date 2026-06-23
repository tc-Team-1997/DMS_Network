import type { Request, Response } from "express";
import type { RealtimeHub, SocketLike } from "./hub.js";

export function sseHandler(hub: RealtimeHub) {
  return (req: Request, res: Response): void => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(": connected\n\n");
    const client: SocketLike = { send: (d: string) => res.write(`data: ${d}\n\n`), readyState: 1 };
    hub.add(client);
    req.on("close", () => hub.remove(client));
  };
}
