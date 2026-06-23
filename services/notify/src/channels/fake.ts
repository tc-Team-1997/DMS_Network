import type { ChannelAdapter, ChannelKey, DeliveryResult, Notification } from "./types.js";

export class FakeAdapter implements ChannelAdapter {
  readonly key: ChannelKey;
  readonly sent: Notification[] = [];
  private readonly failOn?: (n: Notification) => boolean;

  constructor(key: ChannelKey, opts?: { failOn?: (n: Notification) => boolean }) {
    this.key = key;
    this.failOn = opts?.failOn;
  }

  async send(n: Notification): Promise<DeliveryResult> {
    this.sent.push(n);
    if (this.failOn?.(n)) {
      return { channel: this.key, recipient: n.recipient, status: "failed", error: "fake_failure" };
    }
    return { channel: this.key, recipient: n.recipient, status: "sent", providerId: `fake-${this.sent.length}` };
  }
}
