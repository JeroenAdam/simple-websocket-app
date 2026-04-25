const http = require('http');
const https = require('https');
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
    winston.format.printf(({ timestamp, message }) => `${timestamp} ${message}`)
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

// ── Favicon Caching System ───────────────────────────────────────
const FAVICON_DIR = path.join(__dirname, 'favicons');
if (!fs.existsSync(FAVICON_DIR)) fs.mkdirSync(FAVICON_DIR, { recursive: true });

function getDomainFromUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace('www.', '');
  } catch (err) {
    console.error(`⚠️ Invalid URL: ${url} | Error: ${err.message}`);
    return null;
  }
}

function fetchFavicon(domain) {
  return new Promise((resolve, reject) => {
    const filePath = path.join(FAVICON_DIR, `${domain}.png`);
    
    // Return cached if exists
    if (fs.existsSync(filePath)) {
      console.log(`✅ Cached favicon found: ${domain}`);
      return resolve(filePath);
    }

    console.log(`🌐 Fetching favicon for: ${domain}`);
    
    // Method 1: Google Favicon API
    const googleUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
    
    https.get(googleUrl, (res) => {
      if (res.statusCode === 200) {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          fs.writeFileSync(filePath, buffer);
          console.log(`✅ Saved favicon: ${domain} (${buffer.length} bytes)`);
          resolve(filePath);
        });
      } else if (res.statusCode === 302 || res.statusCode === 301) {
        // Follow redirect to actual favicon URL
        console.log(`🔄 Following redirect for ${domain}`);
        const redirectUrl = res.headers.location;
        https.get(redirectUrl, (res2) => {
          const chunks = [];
          res2.on('data', chunk => chunks.push(chunk));
          res2.on('end', () => {
            fs.writeFileSync(filePath, Buffer.concat(chunks));
            console.log(`✅ Saved favicon via redirect: ${domain}`);
            resolve(filePath);
          });
        }).on('error', (err) => reject(err));
      } else {
        console.error(`❌ Google API failed for ${domain}: ${res.statusCode}`);
        // Fallback: try direct favicon.ico
        fetchDirectFavicon(domain, filePath).then(resolve).catch(reject);
      }
    }).on('error', (err) => {
      console.error(`❌ Network error fetching ${domain}: ${err.message}`);
      fetchDirectFavicon(domain, filePath).then(resolve).catch(reject);
    });
  });
}

function fetchDirectFavicon(domain, filePath) {
  return new Promise((resolve, reject) => {
    const directUrl = `https://${domain}/favicon.ico`;
    console.log(`🔗 Trying direct favicon: ${directUrl}`);
    
    https.get(directUrl, (res) => {
      if (res.statusCode === 200 && res.headers['content-type']?.includes('image')) {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          fs.writeFileSync(filePath, Buffer.concat(chunks));
          console.log(`✅ Saved direct favicon: ${domain}`);
          resolve(filePath);
        });
      } else {
        reject(new Error('Direct favicon failed'));
      }
    }).on('error', reject);
  });
}

// ── HTTP + WebSocket Server Setup ────────────────────────────────
const PORT = process.env.PORT || 80;
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  console.log(`📥 Request: ${req.method} ${req.url}`);

  // 1. Favicon API
  if (req.url.startsWith('/api/favicon') && req.method === 'GET') {
    const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const targetUrl = urlParams.get('url');
    
    if (!targetUrl) {
      console.log('❌ Missing url parameter');
      return res.writeHead(400).end('Missing url parameter');
    }
    
    const domain = getDomainFromUrl(targetUrl);
    if (!domain) {
      console.log('❌ Invalid URL format');
      return res.writeHead(400).end('Invalid URL');
    }
    
    fetchFavicon(domain)
      .then(filePath => {
        const stat = fs.statSync(filePath);
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=86400'
        });
        fs.createReadStream(filePath).pipe(res);
      })
      .catch((err) => {
        console.error(`❌ Favicon error: ${err.message}`);
        res.writeHead(404).end('Favicon not found');
      });
    return;
  }

  // 2. List log files
  if (req.url === '/api/logs' && req.method === 'GET') {
    const logsDir = path.join(__dirname, 'logs');
    fs.readdir(logsDir, (err, files) => {
      if (err) return res.writeHead(500).end(JSON.stringify({ error: 'Directory read failed' }));
      const logFiles = files.filter(f => f.startsWith('websocket-') && f.endsWith('.log'));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(logFiles.sort().reverse()));
    });
    return;
  }

  // 3. Fetch specific log content
  if (req.url.startsWith('/api/logs/') && req.method === 'GET') {
    const filename = path.basename(req.url);
    const safeFilename = path.normalize(filename).replace(/^(\.\.(\/|\\|$))+/, '');
    const filePath = path.join(__dirname, 'logs', safeFilename);
    
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err || !data) return res.writeHead(404).end(JSON.stringify({ error: 'Log not found' }));
      res.setHeader('Content-Type', 'text/plain');
      res.end(data);
    });
    return;
  }

  // 4. Serve index.html
  fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
    if (err) return res.writeHead(500).end('Server Error');
    res.setHeader('Content-Type', 'text/html');
    res.end(data);
  });
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
  console.log(`🌐 HTTP routes active on http://localhost:${PORT}`);
  console.log(`💾 Favicons will be cached in ./favicons/`);
});
