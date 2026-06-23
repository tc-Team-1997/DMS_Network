import type { Knex } from "knex";
import type { ChannelAdapter, ChannelKey, DeliveryResult, Notification } from "./types.js";
import type { RealtimeHub } from "../realtime/hub.js";

export class InAppAdapter implements ChannelAdapter {
  readonly key: ChannelKey = "inapp";
  constructor(private readonly knex: Knex, private readonly hub: RealtimeHub) {}

  async send(n: Notification): Promise<DeliveryResult> {
    // Persistence of the `notifications` row is handled by alertService's dispatch loop;
    // the in-app channel's job is the realtime push to connected clients.
    this.hub.broadcast({ type: "notification", channel: "inapp", recipient: n.recipient, subject: n.subject, body: n.body, meta: n.meta });
    return { channel: this.key, recipient: n.recipient, status: "sent", providerId: "inapp" };
  }
}
