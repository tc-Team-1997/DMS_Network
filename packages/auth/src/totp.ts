import speakeasy from "speakeasy";

export function generateMfaSecret(label: string): { base32: string; otpauthUrl: string } {
  const secret = speakeasy.generateSecret({ name: label });
  return { base32: secret.base32, otpauthUrl: secret.otpauth_url ?? "" };
}

export function verifyTotp(secretBase32: string, token: string): boolean {
  return speakeasy.totp.verify({ secret: secretBase32, encoding: "base32", token, window: 1 });
}
