'use strict';
/**
 * Invite mailer — sends magic-link invite emails via tenant-configured SMTP.
 *
 * Reads SMTP config from tenant_config namespace 'notifications':
 *   smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_tls
 *
 * Falls back to jsonTransport (no-op) when config is missing so local dev
 * without SMTP continues to work.  The invite link is always logged so
 * developers can manually complete flows.
 */

const nodemailer = require('nodemailer');
const { getConfig } = require('../db/tenant-config');

/**
 * Build a nodemailer transport for the given tenant.
 * Returns a jsonTransport when SMTP is not configured.
 */
function _buildTransport(tenantId) {
  const host = getConfig(tenantId, 'notifications', 'smtp_host', null);
  if (!host) {
    return nodemailer.createTransport({ jsonTransport: true });
  }
  const port    = getConfig(tenantId, 'notifications', 'smtp_port', 587);
  const user    = getConfig(tenantId, 'notifications', 'smtp_user', null);
  const pass    = getConfig(tenantId, 'notifications', 'smtp_pass', null);
  const from    = getConfig(tenantId, 'notifications', 'smtp_from', 'noreply@docmanager.local');
  const tlsMode = getConfig(tenantId, 'notifications', 'smtp_tls', 'starttls');

  const secure = tlsMode === 'ssl';
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass: pass ?? '' } : undefined,
    from,
  });
}

/**
 * Send an invite email with a magic link.
 *
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {string} opts.toEmail      — recipient email
 * @param {string} opts.rawToken     — 32-byte hex token (NOT hashed)
 * @param {string} opts.role         — role being granted
 * @param {string} opts.inviterName  — full name of admin sending invite
 * @param {string} opts.baseUrl      — e.g. http://localhost:3000
 */
async function sendInvite({ tenantId, toEmail, rawToken, role, inviterName, baseUrl }) {
  const link = `${baseUrl}/set-password?token=${encodeURIComponent(rawToken)}`;
  const ttlHours = getConfig(tenantId, 'auth', 'magic_link_ttl_hours', 168);
  const from = getConfig(tenantId, 'notifications', 'smtp_from', 'noreply@docmanager.local');

  const subject = 'You have been invited to DocManager';
  const text = [
    `Hello,`,
    ``,
    `${inviterName} has invited you to access DocManager as a ${role}.`,
    ``,
    `Click the link below to set your password and activate your account:`,
    `${link}`,
    ``,
    `This link expires in ${ttlHours} hours and can only be used once.`,
    ``,
    `If you did not request this invitation, you can safely ignore this email.`,
  ].join('\n');

  const transport = _buildTransport(tenantId);

  try {
    const info = await transport.sendMail({ from, to: toEmail, subject, text });
    console.log(`[invite-mailer] -> ${toEmail} (tenant:${tenantId}) link:${link}`, info.messageId ?? '');
    return { ok: true };
  } catch (err) {
    // Always log the link so local-dev flows are not blocked.
    console.error(`[invite-mailer] FAILED -> ${toEmail}:`, err.message);
    console.log(`[invite-mailer] Magic link for manual use: ${link}`);
    return { ok: false, error: err.message };
  }
}

module.exports = { sendInvite };
