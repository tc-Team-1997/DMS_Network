const nodemailer = require('nodemailer');
const db = require('../db');

const transport = nodemailer.createTransport({
  jsonTransport: true
});

async function notify(userId, channel, subject, body) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return;
  try {
    if (channel === 'email' && user.email) {
      const info = await transport.sendMail({
        from: 'dms@nbe.local',
        to: user.email,
        subject,
        text: body
      });
      console.log(`[notify:email] -> ${user.email}: ${subject}`);
    } else {
      console.log(`[notify:${channel}] -> ${user.username}: ${subject}`);
    }
    db.prepare('INSERT INTO notifications (user_id, channel, subject, body, status) VALUES (?,?,?,?,?)')
      .run(userId, channel, subject, body, 'sent');
  } catch (err) {
    db.prepare('INSERT INTO notifications (user_id, channel, subject, body, status) VALUES (?,?,?,?,?)')
      .run(userId, channel, subject, body, 'failed:' + err.message);
  }
}

function broadcast(role, channel, subject, body) {
  const users = db.prepare('SELECT id FROM users WHERE role = ? AND status = ?').all(role, 'Active');
  users.forEach(u => notify(u.id, channel, subject, body));
}

module.exports = { notify, broadcast };
