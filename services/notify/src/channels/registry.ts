import type { ChannelAdapter, ChannelKey, DeliveryResult, Notification } from "./types.js";
import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";
import type { RealtimeHub } from "../realtime/hub.js";

export class ChannelRegistry {
  private readonly adapters = new Map<ChannelKey, ChannelAdapter>();

  register(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.key, adapter);
  }

  get(key: ChannelKey): ChannelAdapter | undefined {
    return this.adapters.get(key);
  }

  async dispatch(channels: ChannelKey[], base: Omit<Notification, "channel">): Promise<DeliveryResult[]> {
    return Promise.all(
      channels.map(async (channel) => {
        const adapter = this.adapters.get(channel);
        if (!adapter) {
          return { channel, recipient: base.recipient, status: "failed" as const, error: `no adapter for channel "${channel}"` };
        }
        try {
          return await adapter.send({ ...base, channel });
        } catch (err) {
          return { channel, recipient: base.recipient, status: "failed" as const, error: (err as Error).message };
        }
      }),
    );
  }
}

export async function buildRegistry(deps: { knex: Knex; config: AppConfig; hub: RealtimeHub }): Promise<ChannelRegistry> {
  const [nodemailer, twilio, { EmailAdapter }, { SmsAdapter }, { WhatsAppAdapter }, { TeamsAdapter }, { InAppAdapter }] = await Promise.all([
    import("nodemailer"),
    import("twilio"),
    import("./email.js"),
    import("./sms.js"),
    import("./whatsapp.js"),
    import("./teams.js"),
    import("./inapp.js"),
  ]);

  const reg = new ChannelRegistry();
  const env = process.env;

  const smtpPort = Number(env.SMTP_PORT ?? 587);
  const transport = env.SMTP_HOST
    ? nodemailer.default.createTransport({
        host: env.SMTP_HOST,
        port: smtpPort,
        // Implicit TLS is required on 465 (Zoho). 587 uses STARTTLS (secure:false).
        secure: env.SMTP_SECURE === "true" || smtpPort === 465,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? "" } : undefined,
      })
    : nodemailer.default.createTransport({ jsonTransport: true });
  reg.register(new EmailAdapter(transport, env.SMTP_FROM ?? "dms@bob.bt"));

  const twilioClient = env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN
    ? twilio.default(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN)
    : null;
  reg.register(new SmsAdapter(twilioClient as any, env.TWILIO_SMS_FROM ?? ""));
  reg.register(new WhatsAppAdapter(twilioClient as any, env.TWILIO_WA_FROM ?? ""));
  reg.register(new TeamsAdapter(env.TEAMS_WEBHOOK_URL ?? null));
  reg.register(new InAppAdapter(deps.knex, deps.hub));
  return reg;
}
