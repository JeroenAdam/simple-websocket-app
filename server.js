const { WebSocketServer, WebSocket } = require('ws');
const winston = require('winston');
const Transport = require('winston-daily-rotate-file');

// ── Logger Setup (Daily Rotation) ────────────────────────────────
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, message }) => 
      `[${timestamp}] ${message}`
    )
  ),
  transports: [
    new winston.transports.Console(),
    new Transport({
      filename: 'logs/websocket-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '999d',
      zippedArchive: false
    })
  ]
});

// ── WebSocket Server Setup ───────────────────────────────────────
const PORT = process.env.PORT || 80;
const wss = new WebSocketServer({ port: PORT, host: '0.0.0.0' });

const clients = new Map();
const ipToName = {
  '127.0.0.1': 'youssef',
  '192.168.0.1': 'youssef',
  '192.168.0.2': 'adam'
};

wss.on('connection', (ws) => {
  const rawIP = ws._socket?.remoteAddress || 'unknown';
  const clientIP = rawIP.replace('::ffff:', '');
  const clientName = ipToName[clientIP] || 'unknown';
  
  clients.set(ws, { name: clientName, ip: clientIP });

  ws.on('message', (data) => {
    const msg = data.toString();
    const { name } = clients.get(ws) || {};
    
    // Detect Base64 images
    if (msg.startsWith('data:image/')) {
      logger.info(`🖼️ ${name} sent an image (${Math.round(msg.length / 1024)}KB)`);
      broadcastImage(ws, msg);
    } else {
      logger.info(`📨 ${name}: ${msg}`);
      broadcastToOthers(ws, msg);
    }
  });

  ws.on('close', () => clients.delete(ws));
  ws.on('error', (err) => {
    logger.error(`⚠️ WebSocket error: ${err.message}`);
    clients.delete(ws);
  });
});

function broadcastToOthers(sender, message) {
  const senderName = sender && clients.has(sender) ? clients.get(sender).name : 'Unknown';
  const payload = sender ? `[${senderName}] ${message}` : `[system] ${message}`;
  
  clients.forEach((data, client) => {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// New: Broadcast images with a clear marker so frontend can parse them
function broadcastImage(sender, imageData) {
  const payload = `[img]${imageData}`;
  clients.forEach((data, client) => {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

console.log(`🚀 Server listening on ws://localhost:${PORT}`);
