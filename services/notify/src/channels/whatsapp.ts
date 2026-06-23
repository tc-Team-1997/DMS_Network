import type { ChannelAdapter, ChannelKey, DeliveryResult, Notification } from "./types.js";
import type { TwilioLike } from "./sms.js";

export class WhatsAppAdapter implements ChannelAdapter {
  readonly key: ChannelKey = "whatsapp";
  constructor(private readonly client: TwilioLike | null, private readonly from: string) {}

  async send(n: Notification): Promise<DeliveryResult> {
    if (!this.client) return { channel: this.key, recipient: n.recipient, status: "failed", error: "whatsapp_not_configured" };
    try {
      const msg = await this.client.messages.create({ to: `whatsapp:${n.recipient}`, from: `whatsapp:${this.from}`, body: n.body });
      return { channel: this.key, recipient: n.recipient, status: "sent", providerId: msg.sid };
    } catch (err) {
      return { channel: this.key, recipient: n.recipient, status: "failed", error: (err as Error).message };
    }
  }
}
