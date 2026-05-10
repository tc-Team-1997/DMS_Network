'use strict';

/**
 * Email helper stub.
 *
 * In development (NODE_ENV !== 'production') a console.log replaces the real
 * send so no SMTP credentials are required during local development or CI.
 *
 * In production the function requires: SMTP_HOST, SMTP_PORT (default 587),
 * optionally SMTP_USER / SMTP_PASS, RESET_EMAIL_FROM, APP_URL.
 * nodemailer is lazy-required only in production so it does not need to be
 * installed for development or test environments.
 */

async function sendResetEmail(to, token) {
  if (process.env.NODE_ENV === 'production') {
    const nodemailer = require('nodemailer');
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
    await transport.sendMail({
      to,
      from: process.env.RESET_EMAIL_FROM || 'no-reply@dms.local',
      subject: 'Password reset',
      text: `Click to reset: ${process.env.APP_URL || 'http://localhost:3000'}/reset-password?token=${token}`,
    });
  } else {
    console.log(`[reset-email] would send token=${token} to=${to}`);
  }
}

module.exports = { sendResetEmail };
