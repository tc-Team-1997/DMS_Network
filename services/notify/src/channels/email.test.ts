import { describe, it, expect } from "vitest";
import nodemailer from "nodemailer";
import { EmailAdapter } from "./email.js";

describe("EmailAdapter", () => {
  it("sends via the injected transport (jsonTransport in test)", async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const adapter = new EmailAdapter(transport, "dms@bob.bt");
    const res = await adapter.send({ channel: "email", recipient: "rm@bob.bt", subject: "Expiry", body: "CID expires soon" });
    expect(res.status).toBe("sent");
    expect(res.providerId).toBeTruthy();
  });
});
