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

// Map to store client data: ws -> { name, ip }
const clients = new Map();

// IP to username mapping (adjust as needed)
const ipToName = {
  '127.0.0.1': 'youssef',
  '192.168.0.2': 'adam'
};

// Removed server start log per your request
// logger.info(`🚀 Server listening on ws://localhost:${PORT}`);

wss.on('connection', (ws) => {
  const rawIP = ws._socket?.remoteAddress || 'unknown';
  // Normalize IPv4-mapped IPv6 addresses (Node.js often returns ::ffff:127.0.0.1)
  const clientIP = rawIP.replace('::ffff:', '');
  const clientName = ipToName[clientIP] || 'unknown';
  
  clients.set(ws, { name: clientName, ip: clientIP });

  // Removed system connection logs per your request

  ws.on('message', (data) => {
    const msg = data.toString();
    const { name } = clients.get(ws) || {};
    
    logger.info(`📨 ${name}: ${msg}`);
    
    broadcastToOthers(ws, msg);
  });

  ws.on('close', () => {
    clients.delete(ws);
    // Removed system disconnection log per your request
  });

  ws.on('error', (err) => {
    logger.error(`⚠️  WebSocket error: ${err.message}`);
    clients.delete(ws);
  });
});

function broadcastToOthers(sender, message) {
  // Safely extract the sender's name from our Map
  const senderName = sender && clients.has(sender) ? clients.get(sender).name : 'Unknown';
  
  // Send [username] for chat, [system] for system events
  const payload = sender ? `[${senderName}] ${message}` : `[system] ${message}`;
  
  clients.forEach((data, client) => {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

console.log(`🚀 Server listening on ws://localhost:${PORT}`);