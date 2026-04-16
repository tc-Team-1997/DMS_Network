const WebSocket = require('ws');
let wss = null;

function attach(server) {
  wss = new WebSocket.Server({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'hello', message: 'NBE DMS live alerts connected' }));
  });
  console.log('[ws] live alert channel attached at /ws');
}

function broadcast(payload) {
  if (!wss) return;
  const msg = JSON.stringify(payload);
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

module.exports = { attach, broadcast };
