const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const dayjs = require('dayjs');
const QRCode = require('qrcode');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
// Load environment variables from .env
require('dotenv').config();

const PORT = process.env.PORT || 3000;
// AGENT_PIN must be provided via environment variable for security
const AGENT_PIN = process.env.AGENT_PIN;
if (!AGENT_PIN) {
  console.error('嚴重錯誤：需要 AGENT_PIN 環境變數。');
  process.exit(1);
}

// ALLOWED_ORIGINS: comma-separated list of allowed origins for CORS (defaults to localhost)
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS && process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)) || ['http://localhost:3000'];
// PUBLIC_ORIGIN: optional explicit public origin (e.g. https://example.com) used when building
// public links (QR codes). If not set the server will try to infer from incoming requests.
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || null;

// Ensure db folder exists
const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const dbPath = path.join(dbDir, 'queue.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
// If DB is temporarily locked by another process, wait up to 5s before failing
try {
  db.pragma('busy_timeout = 5000');
} catch (e) {
  console.warn('Could not set busy_timeout pragma', e && e.message);
}

try {
  db.exec(`
CREATE TABLE IF NOT EXISTS seq (
  serviceType TEXT NOT NULL,
  ymd TEXT NOT NULL,
  seq INTEGER NOT NULL,
  PRIMARY KEY (serviceType, ymd)
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serviceType TEXT NOT NULL,
  number TEXT NOT NULL,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'waiting',
  counter TEXT,
  result TEXT,
  createdAt TEXT NOT NULL,
  calledAt TEXT,
  finishedAt TEXT
);
`);
} catch (err) {
  if (err && err.code === 'SQLITE_BUSY') {
    console.error('\nSQLite database is locked. Common causes:\n - another process is accessing the same DB file (another server instance, sqlite viewer)\n - leftover .db-wal/.db-shm files from a crash\n\nSuggested actions:\n - make sure no other Node process or sqlite client is using the DB file\n - restart your machine if unsure\n - remove or close editors that may hold the file lock\n - as a temporary workaround, stop nodemon and run `node server.js` once to see the error\n');
  }
  throw err;
}
// create agents table
try {
  db.exec(`
CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL UNIQUE,
  name TEXT,
  password TEXT NOT NULL,
  counter TEXT,
  role TEXT,
  active INTEGER DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT
);
`);
} catch (err) {
  if (err && err.code === 'SQLITE_BUSY') {
    console.error('SQLite busy when creating agents table');
  }
  throw err;
}

function getNextNumber(serviceType) {
  const ymd = dayjs().format('YYYYMMDD');
  // Use a database transaction to ensure selecting and updating/inserting
  // the seq row happens atomically to avoid race conditions under concurrent calls.
  const getNext = db.transaction((svc) => {
    const ymd = dayjs().format('YYYYMMDD');
    const row = db.prepare('SELECT seq FROM seq WHERE serviceType=? AND ymd=?').get(svc, ymd);
    let next;
    if (row) {
      next = row.seq + 1;
      db.prepare('UPDATE seq SET seq=? WHERE serviceType=? AND ymd=?').run(next, svc, ymd);
    } else {
      next = 1;
      db.prepare('INSERT INTO seq(serviceType, ymd, seq) VALUES (?, ?, ?)').run(svc, ymd, next);
    }
    const padded = String(next).padStart(3, '0');
    return `${svc}${padded}`;
  });

  // Call the transaction function with the provided serviceType
  return getNext(serviceType);
}

const app = express();
// Trust reverse proxy headers (needed for dev tunnels / reverse proxies)
// This allows express-rate-limit to safely use X-Forwarded-For for client IP.
app.set('trust proxy', 1);
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, { cors: { origin: ALLOWED_ORIGINS } });

// CORS: only allow explicit origins; block requests with unknown or missing Origin in production
app.use(cors({
  origin: (origin, cb) => {
    // allow requests with no origin (curl, server-to-server) or allowlist matches
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error('CORS origin denied'));
  },
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Minimal CSP to allow our local app (scripts/styles inline for demo) and websockets
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; font-src 'self' data: https://r2cdn.perplexity.ai; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:"
  );
  next();
});

// --- Rate limiters ---
const isProd = process.env.NODE_ENV === 'production';
const commonLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
});
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many login attempts, please try later' }
});
const captchaLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false
});
const qrcodeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false
});
const adminAgentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
});

// --- simple in-memory captcha store { token: { code, expiresAt }} ---
const captchaStore = {};
const svgCaptcha = require('svg-captcha');
function genToken() { return Math.random().toString(36).slice(2, 10); }

// --- simple in-memory CSRF store for admin UI { token: { createdAt }} ---
const csrfStore = {};
function genCsrf() { return Math.random().toString(36).slice(2, 12) + Date.now().toString(36); }
// purge expired csrf tokens every 5 minutes (tokens valid 15 minutes)
setInterval(() => {
  const now = Date.now();
  for (const t in csrfStore) { if (now - (csrfStore[t].createdAt || 0) > 15 * 60 * 1000) delete csrfStore[t]; }
}, 5 * 60 * 1000);

// purge expired captchas every minute
setInterval(() => {
  const now = Date.now();
  for (const t in captchaStore) { if (captchaStore[t].expiresAt < now) delete captchaStore[t]; }
}, 60 * 1000);

// Get a new captcha token
app.get('/api/captcha/new', captchaLimiter, (req, res) => {
  const token = genToken();
  const expiresAt = Date.now() + (5 * 60 * 1000);
  // generate and store placeholder; image route will regenerate SVG/PNG fresh to avoid caching issues
  const captcha = svgCaptcha.create({ noise: 3, size: 6, color: true, background: '#f3f4f6', width: 160, height: 60 });
  // store both text and svg so image endpoint can use exact svg for PNG conversion
  captchaStore[token] = { code: captcha.text, svg: captcha.data, expiresAt };
  res.json({ token, expiresAt });
});

// Return PNG image for a given token
app.get('/api/captcha/image/:token', captchaLimiter, async (req, res) => {
  const { token } = req.params;
  const rec = captchaStore[token];
  if (!rec || rec.expiresAt < Date.now()) return res.status(404).send('invalid token');
  // use the stored SVG (created when token was issued) to avoid fragile replacements
  try {
    const svg = rec.svg || (`<svg xmlns="http://www.w3.org/2000/svg"><text>${rec.code}</text></svg>`);
    let sharpLib = null;
    try { sharpLib = require('sharp'); } catch (e) { /* sharp not available */ }
    if (sharpLib) {
      const png = await sharpLib(Buffer.from(svg, 'utf8')).png().toBuffer();
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-store');
      res.send(png);
    } else {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'no-store');
      res.send(svg);
    }
  } catch (err) {
    console.error('captcha image error', err);
    res.status(500).send('captcha error');
  }
});

// Login endpoint: validate captcha token + code, then verify real agent credentials
app.post('/api/login', loginLimiter, (req, res) => {
  const { account, password, captchaToken, captcha } = req.body || {};
  if (!captchaToken || !captcha) return res.status(400).json({ error: 'captcha required' });
  const rec = captchaStore[captchaToken];
  if (!rec) return res.status(400).json({ error: 'invalid or expired captcha token' });
  // compare case-insensitive to be more user friendly
  if (String(rec.code).toLowerCase() !== String(captcha).toLowerCase()) return res.status(400).json({ error: 'captcha mismatch' });
  // consume
  delete captchaStore[captchaToken];
  // Verify credentials strictly
  if (!account) return res.status(401).json({ error: 'invalid credentials' });
  const user = db.prepare('SELECT * FROM agents WHERE account=?').get(account);
  if (!user) return res.status(401).json({ error: 'invalid credentials' });
  const ok = (user.password && password) ? bcrypt.compareSync(String(password), String(user.password)) : false;
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });
  return res.json({ ok: true, agent: { id: user.id, account: user.account, name: user.name, counter: user.counter, role: user.role } });
});

// Issue a CSRF token for admin UI; requires valid x-agent-pin header (requirePin middleware)
app.post('/api/admin/csrf', adminAgentLimiter, requirePin, (req, res) => {
  try {
    const token = genCsrf();
    csrfStore[token] = { createdAt: Date.now() };
    res.json({ csrfToken: token, expiresIn: 15 * 60 });
  } catch (err) { res.status(500).json({ error: 'csrf error' }); }
});

// --- agents management API (simple CRUD) ---
app.get('/api/agents', requirePin, (req, res) => {
  const rows = db.prepare('SELECT id, account, name, counter, role, active, createdAt, updatedAt FROM agents ORDER BY id DESC').all();
  res.json({ agents: rows });
});

app.post('/api/agents', requirePin, requireCsrf, (req, res) => {
  const { account, name, password, counter, role } = req.body || {};
  if (!account || !password) return res.status(400).json({ error: 'account and password required' });
  const now = dayjs().toISOString();
  const hash = bcrypt.hashSync(String(password), 10);
  try {
    const info = db.prepare('INSERT INTO agents(account,name,password,counter,role,createdAt) VALUES (?,?,?,?,?,?)').run(account, name || null, hash, counter || null, role || null, now);
    const row = db.prepare('SELECT id, account, name, counter, role, active, createdAt, updatedAt FROM agents WHERE id=?').get(info.lastInsertRowid);
    res.json({ agent: row });
  } catch (err) {
    if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(400).json({ error: 'account exists' });
    console.error('create agent error', err);
    res.status(500).json({ error: 'create failed' });
  }
});

app.get('/api/agents/:id', requirePin, (req, res) => {
  const row = db.prepare('SELECT id, account, name, counter, role, active, createdAt, updatedAt FROM agents WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json({ agent: row });
});

app.put('/api/agents/:id', requirePin, requireCsrf, (req, res) => {
  const id = req.params.id;
  const { name, password, counter, role, active } = req.body || {};
  const now = dayjs().toISOString();
  const existing = db.prepare('SELECT * FROM agents WHERE id=?').get(id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const hash = password ? bcrypt.hashSync(String(password), 10) : existing.password;
  db.prepare('UPDATE agents SET name=?, password=?, counter=?, role=?, active=?, updatedAt=? WHERE id=?')
    .run(name || existing.name, hash, counter || existing.counter, role || existing.role, (active === undefined ? existing.active : active), now, id);
  const row = db.prepare('SELECT id, account, name, counter, role, active, createdAt, updatedAt FROM agents WHERE id=?').get(id);
  res.json({ agent: row });
});

app.delete('/api/agents/:id', requirePin, requireCsrf, (req, res) => {
  const id = req.params.id;
  db.prepare('DELETE FROM agents WHERE id=?').run(id);
  res.json({ ok: true });
});

// Static assets
app.use(express.static(path.join(__dirname, 'public')));

// Helpers
function emitQueueUpdate(serviceType) {
  const overview = getOverview();
  io.emit('queue:update', { serviceType, overview });
}

function getOverview() {
  const rows = db.prepare(`
    SELECT serviceType,
           SUM(CASE WHEN status='waiting' THEN 1 ELSE 0 END) AS waiting,
           SUM(CASE WHEN status='called' THEN 1 ELSE 0 END) AS called,
           SUM(CASE WHEN status='serving' THEN 1 ELSE 0 END) AS serving,
           SUM(CASE WHEN status='finished' THEN 1 ELSE 0 END) AS finished
    FROM tickets
    GROUP BY serviceType
  `).all();
  const currentCalls = db.prepare(`
    SELECT id, serviceType, number, counter, calledAt
    FROM tickets
    WHERE status IN ('called','serving')
    ORDER BY calledAt DESC
    LIMIT 50
  `).all();
  return { summary: rows, currentCalls };
}

// API routes
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Return runtime config useful for clients that need to generate public links (QR)
function inferPublicOrigin(req) {
  if (PUBLIC_ORIGIN) return PUBLIC_ORIGIN;
  // respect X-Forwarded-Proto when behind reverse proxies (nginx, cloudflare, tunnels)
  const forwardedProto = (req.get('x-forwarded-proto') || '').split(',')[0];
  const proto = forwardedProto || req.protocol || 'http';
  const host = req.get('host') || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

// 檢查目前環境類型
function detectEnvironment(req) {
  const host = req.get('host') || `localhost:${PORT}`;
  const hostname = host.split(':')[0];
  
  const env = {
    isLocal: false,
    isDevTunnel: false,
    isProduction: false,
    hostname,
    port: PORT,
    nodeEnv: process.env.NODE_ENV || 'development'
  };

  // 檢查是否為本地環境
  if (hostname === 'localhost' || hostname === '127.0.0.1' || 
      hostname.startsWith('192.168.') || hostname.startsWith('10.')) {
    env.isLocal = true;
  }
  
  // 檢查是否為 DevTunnel
  if (hostname.includes('devtunnels.ms')) {
    env.isDevTunnel = true;
  }
  
  // 檢查是否為正式環境
  if (!env.isLocal && !env.isDevTunnel) {
    env.isProduction = true;
  }

  return env;
}

app.get('/api/config', (req, res) => {
  try {
    const publicOrigin = inferPublicOrigin(req);
    const environment = detectEnvironment(req);
    
    res.json({ 
      publicOrigin,
      environment,
      allowedOrigins: ALLOWED_ORIGINS,
      features: {
        autoRedirect: true,
        smartUrlDetection: true
      }
    });
  } catch (err) {
    console.error('Config API error:', err);
    res.status(500).json({ error: 'config error' });
  }
});

app.post('/api/tickets', (req, res) => {
  try {
    const { serviceType } = req.body || {};
    let { phone } = req.body || {};
    if (!serviceType) return res.status(400).json({ error: 'serviceType is required' });
    // normalize phone: keep digits only, treat empty as null
    phone = phone ? String(phone).replace(/\D/g, '') : null;
    if (phone === '') phone = null;
    // phone is required
    if (!phone) return res.status(400).json({ error: 'phone is required' });
    const createdAt = dayjs().toISOString();
    const number = getNextNumber(serviceType.toUpperCase());
    const info = db.prepare(`
      INSERT INTO tickets(serviceType, number, phone, status, createdAt)
      VALUES (?, ?, ?, 'waiting', ?)
    `).run(serviceType.toUpperCase(), number, phone || null, createdAt);
    const ticket = db.prepare('SELECT * FROM tickets WHERE id=?').get(info.lastInsertRowid);
    emitQueueUpdate(serviceType.toUpperCase());
    res.json({ ticket });
  } catch (err) {
    console.error('create ticket error', err && err.stack || err);
    res.status(500).json({ error: 'create failed' });
  }
});

app.get('/api/tickets/waiting', (req, res) => {
  const { serviceType } = req.query;
  const rows = db.prepare(`
    SELECT id, serviceType, number, status, createdAt
    FROM tickets
    WHERE status='waiting'
      ${serviceType ? 'AND serviceType=?' : ''}
    ORDER BY createdAt ASC
  `).all(serviceType ? [serviceType.toUpperCase()] : []);
  res.json({ tickets: rows });
});

// Public ticket detail (sanitized)
app.get('/api/ticket/:id', (req, res) => {
  const { id } = req.params;
  const row = db.prepare('SELECT * FROM tickets WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'not found' });
  const { phone, ...rest } = row;
  res.json({ ticket: rest });
});

// Protected ticket detail for agents (includes phone)
app.get('/api/agent/ticket/:id', requirePin, (req, res) => {
  const { id } = req.params;
  const row = db.prepare('SELECT * FROM tickets WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json({ ticket: row });
});

app.get('/api/overview', (req, res) => {
  res.json(getOverview());
});

function requirePin(req, res, next) {
  // Enforce header PIN only; remove name-based bypass
  const pin = req.get('x-agent-pin');
  if (!AGENT_PIN || pin !== AGENT_PIN) return res.status(401).json({ error: 'unauthorized' });
  next();
}

function requireAgentAuth(req, res, next) {
  // Check for either admin PIN or valid agent authentication
  const pin = req.get('x-agent-pin');
  const agentAccount = req.get('x-agent-account');
  const agentName = req.get('x-agent-name');
  
  // If admin PIN is provided, allow access
  if (AGENT_PIN && pin === AGENT_PIN) {
    return next();
  }
  
  // Otherwise, require agent authentication
  if (!agentAccount || !agentName) {
    return res.status(401).json({ error: 'unauthorized - missing agent credentials' });
  }
  
  // Verify agent exists and is active
  const decodedName = decodeURIComponent(agentName);
  const agent = db.prepare('SELECT * FROM agents WHERE account=? AND name=? AND active=1').get(agentAccount, decodedName);
  if (!agent) {
    return res.status(401).json({ error: 'unauthorized - invalid agent credentials' });
  }
  
  // Store agent info for use in route handler
  req.authenticatedAgent = agent;
  next();
}

function requireCsrf(req, res, next) {
  // Only enforce CSRF for browser-originated requests (with Origin header matching ALLOWED_ORIGINS)
  const origin = req.get('origin');
  if (origin && ALLOWED_ORIGINS.indexOf(origin) !== -1) {
    const token = req.headers['x-csrf-token'];
    if (!token) return res.status(403).json({ error: 'missing csrf token' });
    const rec = csrfStore[token];
    if (!rec) return res.status(403).json({ error: 'invalid or expired csrf token' });
    // token is valid
  }
  next();
}

// Apply rate limiter to all /api/agent/* endpoints
app.use('/api/agent', adminAgentLimiter);

app.post('/api/agent/callNext', requirePin, (req, res) => {
  const { serviceType, counter } = req.body || {};
  if (!serviceType) return res.status(400).json({ error: 'serviceType is required' });
  const ctr = (counter === undefined || counter === null) ? '' : String(counter).trim();
  if (!ctr) return res.status(400).json({ error: 'counter is required' });
  // Prevent same counter from calling multiple tickets at once
  const busy = db.prepare("SELECT id FROM tickets WHERE counter=? AND status IN ('called','serving') LIMIT 1").get(ctr);
  if (busy) return res.status(409).json({ error: 'counter busy', ticketId: busy.id });
  const ticket = db.prepare(`
    SELECT * FROM tickets
    WHERE serviceType=? AND status='waiting'
    ORDER BY createdAt ASC
    LIMIT 1
  `).get(serviceType.toUpperCase());
  if (!ticket) return res.status(404).json({ error: 'no waiting ticket' });
  const calledAt = dayjs().toISOString();
  db.prepare('UPDATE tickets SET status=?, calledAt=?, counter=? WHERE id=?')
    .run('called', calledAt, ctr, ticket.id);
  const updated = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticket.id);
  io.emit('call:made', { ticket: updated });
  emitQueueUpdate(serviceType.toUpperCase());
  res.json({ ticket: updated });
});

app.post('/api/agent/finish', requirePin, (req, res) => {
  const { ticketId, result, verify4 } = req.body || {};
  if (!ticketId) return res.status(400).json({ error: 'ticketId is required' });
  const finishedAt = dayjs().toISOString();
  const row = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (verify4 && row.phone) {
    const last4 = String(row.phone).replace(/\D/g, '').slice(-4);
    if (last4 && last4 !== String(verify4)) {
      return res.status(400).json({ error: 'phone verification failed' });
    }
  }
  db.prepare('UPDATE tickets SET status=?, finishedAt=?, result=? WHERE id=?')
    .run('finished', finishedAt, result || null, ticketId);
  const updated = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId);
  emitQueueUpdate(updated.serviceType);
  res.json({ ticket: updated });
});

app.post('/api/agent/markServing', requirePin, (req, res) => {
  const { ticketId } = req.body || {};
  if (!ticketId) return res.status(400).json({ error: 'ticketId is required' });
  const row = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId);
  if (!row) return res.status(404).json({ error: 'not found' });
  db.prepare('UPDATE tickets SET status=? WHERE id=?').run('serving', ticketId);
  const updated = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId);
  emitQueueUpdate(updated.serviceType);
  res.json({ ticket: updated });
});

// Recall: re-trigger call for an already called ticket (keep status 'called', update calledAt)
app.post('/api/agent/recall', requirePin, (req, res) => {
  const { ticketId } = req.body || {};
  if (!ticketId) return res.status(400).json({ error: 'ticketId is required' });
  const row = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (!['called', 'serving'].includes(row.status)) return res.status(400).json({ error: 'not callable state' });
  const calledAt = dayjs().toISOString();
  db.prepare('UPDATE tickets SET calledAt=? WHERE id=?').run(calledAt, ticketId);
  const updated = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId);
  io.emit('call:made', { ticket: updated });
  emitQueueUpdate(updated.serviceType);
  res.json({ ticket: updated });
});

// Cancel: mark a ticket as canceled
app.post('/api/agent/cancel', requirePin, (req, res) => {
  const { ticketId, reason } = req.body || {};
  if (!ticketId) return res.status(400).json({ error: 'ticketId is required' });
  const row = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId);
  if (!row) return res.status(404).json({ error: 'not found' });
  const finishedAt = dayjs().toISOString();
  db.prepare('UPDATE tickets SET status=?, finishedAt=?, result=? WHERE id=?')
    .run('canceled', finishedAt, reason || null, ticketId);
  const updated = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId);
  emitQueueUpdate(updated.serviceType);
  res.json({ ticket: updated });
});

// Transfer: change serviceType and/or counter; reset to waiting by default
app.post('/api/agent/transfer', requirePin, (req, res) => {
  const { ticketId, toServiceType, toCounter, keepStatus } = req.body || {};
  if (!ticketId) return res.status(400).json({ error: 'ticketId is required' });
  const row = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId);
  if (!row) return res.status(404).json({ error: 'not found' });
  const targetType = (toServiceType || row.serviceType || '').toUpperCase();
  const status = keepStatus ? row.status : 'waiting';
  const calledAt = keepStatus ? row.calledAt : null;
  const counter = toCounter !== undefined ? toCounter : (keepStatus ? row.counter : null);
  // If keeping status (e.g., remain 'called' or 'serving') and assigning a counter, ensure that counter is not already busy
  if (keepStatus && counter) {
    const ctr = String(counter);
    const busy = db.prepare("SELECT id FROM tickets WHERE counter=? AND status IN ('called','serving') LIMIT 1").get(ctr);
    if (busy && busy.id !== row.id) return res.status(409).json({ error: 'counter busy', ticketId: busy.id });
  }
  db.prepare('UPDATE tickets SET serviceType=?, counter=?, status=?, calledAt=? WHERE id=?')
    .run(targetType, counter, status, calledAt, ticketId);
  const updated = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId);
  emitQueueUpdate(updated.serviceType);
  res.json({ ticket: updated });
});

// Agent creates a new ticket (counter-created)
app.post('/api/agent/createTicket', requirePin, (req, res) => {
  try {
    const { serviceType } = req.body || {};
    let { phone } = req.body || {};
    if (!serviceType) return res.status(400).json({ error: 'serviceType is required' });
    phone = phone ? String(phone).replace(/\D/g, '') : null;
    if (phone === '') phone = null;
    // force phone required for counter-created tickets
    if (!phone) return res.status(400).json({ error: 'phone is required' });
    const createdAt = dayjs().toISOString();
    const number = getNextNumber(serviceType.toUpperCase());
    const info = db.prepare(`
      INSERT INTO tickets(serviceType, number, phone, status, createdAt)
      VALUES (?, ?, ?, 'waiting', ?)
    `).run(serviceType.toUpperCase(), number, phone || null, createdAt);
    const ticket = db.prepare('SELECT * FROM tickets WHERE id=?').get(info.lastInsertRowid);
    emitQueueUpdate(serviceType.toUpperCase());
    res.json({ ticket });
  } catch (err) {
    console.error('agent create ticket error', err && err.stack || err);
    res.status(500).json({ error: 'create failed' });
  }
});

// Call a specific ticket by id
app.post('/api/agent/callSpecific', requirePin, (req, res) => {
  const { ticketId, counter, internal } = req.body || {};
  if (!ticketId) return res.status(400).json({ error: 'ticketId is required' });
  const ctr = (counter === undefined || counter === null) ? '' : String(counter).trim();
  if (!ctr) return res.status(400).json({ error: 'counter is required' });
  // Prevent same counter from calling multiple tickets at once; allow if busy ticket is the same one being called
  const busy = db.prepare("SELECT id FROM tickets WHERE counter=? AND status IN ('called','serving') LIMIT 1").get(ctr);
  if (busy && String(busy.id) !== String(ticketId)) return res.status(409).json({ error: 'counter busy', ticketId: busy.id });
  const row = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId);
  if (!row) return res.status(404).json({ error: 'not found' });
  const calledAt = dayjs().toISOString();
  db.prepare('UPDATE tickets SET status=?, calledAt=?, counter=? WHERE id=?')
    .run('called', calledAt, ctr, ticketId);
  const updated = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId);
  if (!internal) io.emit('call:made', { ticket: updated });
  emitQueueUpdate(updated.serviceType);
  res.json({ ticket: updated });
});

// History of served/canceled tickets
app.get('/api/agent/history', requirePin, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
  const serviceType = req.query.serviceType ? String(req.query.serviceType).toUpperCase() : null;
  const rows = db.prepare(`
    SELECT * FROM tickets
    WHERE status IN ('finished','canceled')
      ${serviceType ? 'AND serviceType=?' : ''}
    ORDER BY COALESCE(finishedAt, calledAt, createdAt) DESC
    LIMIT ?
  `).all(...(serviceType ? [serviceType, limit] : [limit]));
  res.json({ tickets: rows });
});

// Agent messaging (broadcast to agents)
app.post('/api/agent/message', requirePin, (req, res) => {
  const { text, from, toCounter, toAgent } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text is required' });
  const payload = { text, from: from || 'agent', toCounter: toCounter || null, toAgent: toAgent || null, time: new Date().toISOString() };
  try {
    // If a specific counter is targeted, emit only to that counter room
    if (toCounter) {
      io.to(`counter:${String(toCounter)}`).emit('agent:message', payload);
      return res.json({ ok: true, targeted: 'counter', toCounter });
    }
    // If a specific agent name is targeted, emit only to that agent room
    if (toAgent) {
      io.to(`agent:${String(toAgent)}`).emit('agent:message', payload);
      return res.json({ ok: true, targeted: 'agent', toAgent });
    }
    // Otherwise broadcast to all agents
    io.emit('agent:message', payload);
    res.json({ ok: true });
  } catch (err) {
    console.error('agent message error', err);
    res.status(500).json({ error: 'message send failed' });
  }
});

// Agent profile management: get current agent's info by account from header
app.get('/api/agent/profile', requireAgentAuth, (req, res) => {
  // Use the authenticated agent from middleware
  const agent = req.authenticatedAgent;
  
  // Return safe agent data (exclude password)
  const safeAgent = {
    id: agent.id,
    account: agent.account,
    name: agent.name,
    counter: agent.counter,
    role: agent.role,
    active: agent.active,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt
  };
  
  res.json({ agent: safeAgent });
});

// Agent profile management: update current agent's info (limited fields)
app.put('/api/agent/profile', requireAgentAuth, (req, res) => {
  const agent = req.authenticatedAgent;
  const { name, password, counter } = req.body || {};
  const now = dayjs().toISOString();
  
  // Agents can update their name, password, and counter
  let hash = agent.password;
  if (password) {
    hash = bcrypt.hashSync(String(password), 10);
  }
  
  const updateName = name || agent.name;
  const updateCounter = counter || agent.counter;
  
  db.prepare('UPDATE agents SET name=?, password=?, counter=?, updatedAt=? WHERE id=?')
    .run(updateName, hash, updateCounter, now, agent.id);
  
  const updated = db.prepare('SELECT id, account, name, counter, role, active, createdAt, updatedAt FROM agents WHERE id=?').get(agent.id);
  res.json({ agent: updated });
});

app.get('/api/qrcode', qrcodeLimiter, async (req, res) => {
  try {
    const text = req.query.text;
    if (!text) return res.status(400).send('text is required');
    const buffer = await QRCode.toBuffer(text, { type: 'png', margin: 1, scale: 6 });
    res.setHeader('Content-Type', 'image/png');
    res.send(buffer);
  } catch (err) {
    res.status(500).send('qrcode error');
  }
});

io.on('connection', (socket) => {
  socket.on('join', (room) => socket.join(room));
  socket.on('leave', (room) => {
    try { socket.leave(room); } catch (e) { /* noop */ }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
