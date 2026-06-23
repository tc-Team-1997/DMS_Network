import type { ChannelAdapter, ChannelKey, DeliveryResult, Notification } from "./types.js";

export interface TwilioLike {
  messages: { create(opts: { to: string; from: string; body: string }): Promise<{ sid: string }> };
}

export class SmsAdapter implements ChannelAdapter {
  readonly key: ChannelKey = "sms";
  constructor(private readonly client: TwilioLike | null, private readonly from: string) {}

  async send(n: Notification): Promise<DeliveryResult> {
    if (!this.client) return { channel: this.key, recipient: n.recipient, status: "failed", error: "sms_not_configured" };
    try {
      const msg = await this.client.messages.create({ to: n.recipient, from: this.from, body: n.body });
      return { channel: this.key, recipient: n.recipient, status: "sent", providerId: msg.sid };
    } catch (err) {
      return { channel: this.key, recipient: n.recipient, status: "failed", error: (err as Error).message };
    }
  }
}
