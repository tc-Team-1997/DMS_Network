export type ChannelKey = "email" | "sms" | "whatsapp" | "teams" | "inapp";

export interface Notification {
  channel: ChannelKey;
  recipient: string;
  subject?: string;
  body: string;
  meta?: Record<string, unknown>;
}

export interface DeliveryResult {
  channel: ChannelKey;
  recipient: string;
  status: "sent" | "failed";
  error?: string;
  providerId?: string;
}

export interface ChannelAdapter {
  readonly key: ChannelKey;
  send(n: Notification): Promise<DeliveryResult>;
}
