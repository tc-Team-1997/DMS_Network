import type { Transporter } from "nodemailer";
import type { ChannelAdapter, ChannelKey, DeliveryResult, Notification } from "./types.js";

export class EmailAdapter implements ChannelAdapter {
  readonly key: ChannelKey = "email";
  constructor(private readonly transport: Transporter, private readonly from: string) {}

  async send(n: Notification): Promise<DeliveryResult> {
    try {
      const info = await this.transport.sendMail({
        from: this.from,
        to: n.recipient,
        subject: n.subject ?? "ZorDMS Alert",
        text: n.body,
        // When a rendered HTML body is present, send multipart (html + text).
        ...(n.html ? { html: n.html } : {}),
      });
      return { channel: this.key, recipient: n.recipient, status: "sent", providerId: (info as { messageId?: string }).messageId ?? "queued" };
    } catch (err) {
      return { channel: this.key, recipient: n.recipient, status: "failed", error: (err as Error).message };
    }
  }
}
