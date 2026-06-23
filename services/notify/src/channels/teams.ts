import type { ChannelAdapter, ChannelKey, DeliveryResult, Notification } from "./types.js";

type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>;

export class TeamsAdapter implements ChannelAdapter {
  readonly key: ChannelKey = "teams";
  constructor(private readonly webhookUrl: string | null, private readonly fetchFn: FetchFn = fetch as unknown as FetchFn) {}

  async send(n: Notification): Promise<DeliveryResult> {
    if (!this.webhookUrl) return { channel: this.key, recipient: n.recipient, status: "failed", error: "teams_not_configured" };
    const card = {
      "@type": "MessageCard", "@context": "https://schema.org/extensions",
      summary: n.subject ?? "ZorDMS Alert", themeColor: "0b2e6b",
      title: n.subject ?? "ZorDMS Alert", text: n.body,
    };
    try {
      const res = await this.fetchFn(this.webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(card) });
      if (!res.ok) return { channel: this.key, recipient: n.recipient, status: "failed", error: `teams_http_${res.status}` };
      return { channel: this.key, recipient: n.recipient, status: "sent", providerId: "teams-ok" };
    } catch (err) {
      return { channel: this.key, recipient: n.recipient, status: "failed", error: (err as Error).message };
    }
  }
}
