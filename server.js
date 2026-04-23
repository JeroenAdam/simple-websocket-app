const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const winston = require('winston');
const Transport = require('winston-daily-rotate-file');

// ── Logger Setup (Daily Rotation) ────────────────────────────────
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, message }) => `[${timestamp}] ${message}`)
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

// ── HTTP + WebSocket Server Setup ────────────────────────────────
const PORT = process.env.PORT || 80;
const server = http.createServer((req, res) => {
  // Enable CORS for browser fetch() requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Content-Type', 'application/json');

  // 1. List log files
  if (req.url === '/api/logs' && req.method === 'GET') {
    console.log('📂 API Request: /api/logs');
    const logsDir = path.join(__dirname, 'logs');
    fs.readdir(logsDir, (err, files) => {
      if (err) {
        console.error('⚠️ Failed to read logs directory:', err.message);
        return res.writeHead(500).end(JSON.stringify({ error: 'Directory read failed' }));
      }
      const logFiles = files.filter(f => f.startsWith('websocket-') && f.endsWith('.log'));
      console.log(`✅ Loaded ${logFiles.length} log files from: ${logsDir}`);
      res.end(JSON.stringify(logFiles.sort().reverse()));
    });
  } 
  // 2. Fetch specific log content
  else if (req.url.startsWith('/api/logs/') && req.method === 'GET') {
    const filename = path.basename(req.url);
    console.log(`📄 API Request: /api/logs/${filename}`);
    const safeFilename = path.normalize(filename).replace(/^(\.\.(\/|\\|$))+/, '');
    const filePath = path.join(__dirname, 'logs', safeFilename);
    
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err || !data) {
        console.error(`⚠️ Failed to read log file ${filename}:`, err?.message || 'File empty');
        return res.writeHead(404).end(JSON.stringify({ error: 'Log not found' }));
      }
      res.setHeader('Content-Type', 'text/plain');
      res.end(data);
    });
  } 
  // 3. Serve index.html for all other routes
  else {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) return res.writeHead(500).end('Server Error');
      res.setHeader('Content-Type', 'text/html');
      res.end(data);
    });
  }
});

const wss = new WebSocketServer({ server, maxPayload: 1024 * 1024 * 64 });

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
    
    if (msg.startsWith('data:image/')) {
      logger.info(`🖼️ ${name} sent an image (${Math.round(msg.length / 1024)}KB)`);
      broadcastImage(ws, msg);
    } else if (msg.startsWith('data:video/')) {
      logger.info(`🎥 ${name} sent a video (${Math.round(msg.length / 1024)}KB)`);
      broadcastVideo(ws, msg);
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
    if (client !== sender && client.readyState === WebSocket.OPEN) client.send(payload);
  });
}

function broadcastImage(sender, imageData) {
  const payload = `[img]${imageData}`;
  clients.forEach((data, client) => {
    if (client !== sender && client.readyState === WebSocket.OPEN) client.send(payload);
  });
}

function broadcastVideo(sender, videoData) {
  const payload = `[vid]${videoData}`;
  clients.forEach((data, client) => {
    if (client !== sender && client.readyState === WebSocket.OPEN) client.send(payload);
  });
}

// ── Start Server ─────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server listening on ws://localhost:${PORT}`);
  console.log(`🌐 HTTP routes (logs/index.html) also active on http://localhost:${PORT}`);
});
