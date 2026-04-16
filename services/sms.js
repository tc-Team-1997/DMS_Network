const db = require('../db');

const TWILIO_SID = process.env.TWILIO_SID;
const TWILIO_TOKEN = process.env.TWILIO_TOKEN;
const TWILIO_FROM = process.env.TWILIO_FROM;

let client = null;
if (TWILIO_SID && TWILIO_TOKEN) {
  const twilio = require('twilio');
  client = twilio(TWILIO_SID, TWILIO_TOKEN);
}

async function sendSms(to, body, userId = null) {
  if (!client) {
    console.log(`[sms:stub] -> ${to}: ${body}`);
    db.prepare('INSERT INTO notifications (user_id, channel, subject, body, status) VALUES (?,?,?,?,?)')
      .run(userId, 'sms', to, body, 'stub');
    return { stub: true };
  }
  try {
    const msg = await client.messages.create({ from: TWILIO_FROM, to, body });
    db.prepare('INSERT INTO notifications (user_id, channel, subject, body, status) VALUES (?,?,?,?,?)')
      .run(userId, 'sms', to, body, 'sent:' + msg.sid);
    return msg;
  } catch (err) {
    db.prepare('INSERT INTO notifications (user_id, channel, subject, body, status) VALUES (?,?,?,?,?)')
      .run(userId, 'sms', to, body, 'failed:' + err.message);
    throw err;
  }
}

module.exports = { sendSms };
