const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

function generateSecret(username) {
  return speakeasy.generateSecret({
    name: `ZorDMS (${username})`,
    issuer: 'ZorDMS'
  });
}

async function makeQrDataUrl(otpauthUrl) {
  return QRCode.toDataURL(otpauthUrl);
}

function verifyToken(secret, token) {
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token,
    window: 1
  });
}

module.exports = { generateSecret, makeQrDataUrl, verifyToken };
