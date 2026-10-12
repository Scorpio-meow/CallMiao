const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const helmet = require('helmet');
const dayjs = require('dayjs');
const QRCode = require('qrcode');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
require('dotenv').config();
const PORT = process.env.PORT || 3000;
const isProdEnv = process.env.NODE_ENV === 'production';
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.error('\n⚠️  CRITICAL: SESSION_SECRET is not set!');
  console.error('   Please set SESSION_SECRET in your .env file.');
  console.error('   Generate one using: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"\n');
  process.exit(1);
}
let ALLOWED_ORIGINS = [];
if (process.env.ALLOWED_ORIGINS) {
  ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
} else {
  if (!isProdEnv) {
    ALLOWED_ORIGINS = [`http://localhost:${PORT}`];
  }
}
if (!isProdEnv) {
  const localhostOrigin = `http://localhost:${PORT}`;
  if (!ALLOWED_ORIGINS.includes(localhostOrigin)) {
    ALLOWED_ORIGINS.push(localhostOrigin);
  }
}
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || null;
const TRUST_PROXY = process.env.TRUST_PROXY;
if (isProdEnv) {
  console.log('🔒 Running in PRODUCTION mode');
  const requiredEnvVars = ['ALLOWED_ORIGINS', 'TRUST_PROXY'];
  const missing = requiredEnvVars.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error('\n⚠️  CRITICAL: Production environment requires the following environment variables:');
    missing.forEach(key => console.error(`   - ${key}`));
    console.error('\nPlease set these in your .env file or environment configuration.\n');
    process.exit(1);
  }
  if (!PUBLIC_ORIGIN) {
    console.warn('\n⚠️  WARNING: PUBLIC_ORIGIN is not set; QR/public links will be derived from the request host.\n');
  }
  if (ALLOWED_ORIGINS.some(o => o.includes('localhost') || o.includes('127.0.0.1'))) {
    console.warn('\n⚠️  WARNING: ALLOWED_ORIGINS contains localhost addresses in production mode!');
    console.warn('   This may be a security risk. Please review your CORS configuration.\n');
  }
} else {
  console.log('🔧 Running in DEVELOPMENT mode');
  console.log(`📍 Auto-allowing origin: http://localhost:${PORT}`);
}
const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
const dbPath = path.join(dbDir, 'queue.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
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
  return getNext(serviceType);
}
function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (!isProdEnv) {
    const isLocalhost = origin.match(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/);
    if (isLocalhost) return true;
  }
  const currentLocalhost = `http://localhost:${PORT}`;
  if (origin === currentLocalhost) return true;
  const normalizedOrigin = origin.replace(/\/$/, '');
  return ALLOWED_ORIGINS.includes(normalizedOrigin);
}
// TRUST_PROXY: hop count (e.g. 1), "false", or a comma-separated list of proxy IPs/subnets.
// Only trusted proxies may set X-Forwarded-For/-Host/-Proto (used by req.ip, req.protocol, req.host).
function parseTrustProxy(value) {
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}
const app = express();
if (TRUST_PROXY) app.set('trust proxy', parseTrustProxy(TRUST_PROXY));
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS, credentials: true },
  // The cors option only covers polling; WebSocket upgrades need their own Origin check
  allowRequest: (req, cb) => {
    const origin = req.headers.origin;
    if (isAllowedOrigin(origin)) return cb(null, true);
    console.warn(`⚠️  Socket.IO blocked: ${origin} (not in allowlist)`);
    return cb('origin not allowed', false);
  }
});
app.use(cors({
  origin: (origin, cb) => {
    if (isAllowedOrigin(origin)) return cb(null, true);
    console.warn(`⚠️  CORS blocked: ${origin} (not in allowlist)`);
    return cb(new Error('CORS origin denied'));
  },
  credentials: true
}));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
const SQLiteStore = require('connect-sqlite3')(session);
const sessionMiddleware = session({
  store: new SQLiteStore({
    db: 'sessions.db',
    dir: './db'
  }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProdEnv,
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000,
    sameSite: 'lax'
  },
  name: 'queueSessionId'
});
app.use(sessionMiddleware);
// Share the express-session with Socket.IO so room joins can be authorized
io.engine.use(sessionMiddleware);
// Synchronizer token stored in the server-side session (replaces deprecated csurf cookie mode)
function issueCsrfToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  return req.session.csrfToken;
}
function isValidCsrfToken(req) {
  const expected = req.session && req.session.csrfToken;
  const provided = req.get('x-csrf-token');
  if (!expected || typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function csrfProtection(req, res, next) {
  // Every CSRF-protected route requires login; keep 401 so clients redirect to the login page
  if (!req.session || !req.session.agent) {
    return res.status(401).json({ error: 'unauthorized - not logged in' });
  }
  if (isValidCsrfToken(req)) return next();
  console.warn('⚠️  Invalid CSRF token detected', JSON.stringify({
    path: req.path,
    method: req.method,
    origin: req.get('origin') || req.get('host')
  }));
  return res.status(403).json({ error: 'invalid csrf token' });
}
function conditionalCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const exemptPaths = [
    '/api/tickets',
    '/api/qrcode',
  ];
  if (exemptPaths.includes(req.path)) return next();
  if (req.path.startsWith('/api/captcha')) return next();
  if (req.path === '/api/login') return next();
  return csrfProtection(req, res, next);
}
app.use(conditionalCsrf);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:"],
      fontSrc: ["'self'", "data:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      frameAncestors: ["'self'"],
      // The app is also served over plain HTTP on the LAN (--host)
      upgradeInsecureRequests: null
    }
  }
}));
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
const ticketCreationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many ticket creations, please try later' }
});
const publicReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
});
const staticLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req, res) => req.path && req.path.startsWith('/api')
});
const captchaStore = {};
const svgCaptcha = require('svg-captcha');
function genToken() { return crypto.randomBytes(16).toString('hex'); }
setInterval(() => {
  const now = Date.now();
  for (const t in captchaStore) { if (captchaStore[t].expiresAt < now) delete captchaStore[t]; }
}, 60 * 1000);
app.get('/api/captcha/new', captchaLimiter, (req, res) => {
  const token = genToken();
  const expiresAt = Date.now() + (5 * 60 * 1000);
  const captcha = svgCaptcha.create({ noise: 3, size: 6, color: true, background: '#f3f4f6', width: 160, height: 60 });
  captchaStore[token] = { code: captcha.text, svg: captcha.data, expiresAt };
  res.json({ token, expiresAt });
});
app.get('/api/captcha/image/:token', captchaLimiter, async (req, res) => {
  const { token } = req.params;
  const rec = captchaStore[token];
  if (!rec || rec.expiresAt < Date.now()) return res.status(404).send('invalid token');
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
    console.error('Captcha image generation error:', isProdEnv ? err.message : err);
    res.status(500).send('captcha error');
  }
});
app.post('/api/login', loginLimiter, (req, res) => {
  const { account, password, captchaToken, captcha } = req.body || {};
  if (!captchaToken || !captcha) return res.status(400).json({ error: 'captcha required' });
  const rec = captchaStore[captchaToken];
  if (!rec || rec.expiresAt < Date.now()) return res.status(400).json({ error: 'invalid or expired captcha token' });
  delete captchaStore[captchaToken];
  if (String(rec.code).toLowerCase() !== String(captcha).toLowerCase()) return res.status(400).json({ error: 'captcha mismatch' });
  if (!account) return res.status(401).json({ error: 'invalid credentials' });
  const user = db.prepare('SELECT * FROM agents WHERE account=? AND active=1').get(String(account));
  if (!user) return res.status(401).json({ error: 'invalid credentials' });
  const ok = (user.password && password) ? bcrypt.compareSync(String(password), String(user.password)) : false;
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });
  const agent = {
    id: user.id,
    account: user.account,
    name: user.name,
    counter: user.counter,
    role: user.role
  };
  req.session.regenerate((err) => {
    if (err) {
      console.error('Session regenerate error:', isProdEnv ? err.message : err);
      return res.status(500).json({ error: 'login failed' });
    }
    req.session.agent = agent;
    return res.json({ ok: true, agent });
  });
});
app.post('/api/logout', (req, res) => {
  if (req.session) {
    req.session.destroy(err => {
      if (err) {
        console.error('Logout error:', err);
        return res.status(500).json({ error: 'logout failed' });
      }
      res.clearCookie('queueSessionId');
      res.json({ ok: true });
    });
  } else {
    res.json({ ok: true });
  }
});
app.get('/api/csrf', requireAgentAuth, (req, res) => {
  res.json({ csrfToken: issueCsrfToken(req) });
});
app.use('/api/agents', adminAgentLimiter);
app.get('/api/agents', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT id, account, name, counter, role, active, createdAt, updatedAt FROM agents ORDER BY id DESC').all();
  res.json({ agents: rows });
});
app.post('/api/agents', requireAdmin, (req, res) => {
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
    console.error('Create agent error:', isProdEnv ? err.message : err);
    res.status(500).json({ error: 'create failed' });
  }
});
app.get('/api/agents/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT id, account, name, counter, role, active, createdAt, updatedAt FROM agents WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json({ agent: row });
});
app.put('/api/agents/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  const { name, password, counter, role, active } = req.body || {};
  const now = dayjs().toISOString();
  const existing = db.prepare('SELECT * FROM agents WHERE id=?').get(id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const hash = password ? bcrypt.hashSync(String(password), 10) : existing.password;
  const newRole = role === undefined ? existing.role : (role || null);
  db.prepare('UPDATE agents SET name=?, password=?, counter=?, role=?, active=?, updatedAt=? WHERE id=?')
    .run(name || existing.name, hash, counter || existing.counter, newRole, (active === undefined ? existing.active : active), now, id);
  const row = db.prepare('SELECT id, account, name, counter, role, active, createdAt, updatedAt FROM agents WHERE id=?').get(id);
  res.json({ agent: row });
});
app.delete('/api/agents/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  db.prepare('DELETE FROM agents WHERE id=?').run(id);
  res.json({ ok: true });
});
app.use(staticLimiter);
app.use(express.static(path.join(__dirname, 'public')));
function emitQueueUpdate(serviceType) {
  const overview = getOverview();
  io.emit('queue:update', { serviceType, overview });
}
// Fields safe to expose to anonymous clients; excludes agent notes (result)
function publicTicket(row) {
  if (!row) return row;
  const { id, serviceType, number, status, counter, createdAt, calledAt, finishedAt } = row;
  return { id, serviceType, number, status, counter, createdAt, calledAt, finishedAt };
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
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});
function inferPublicOrigin(req) {
  if (PUBLIC_ORIGIN) return PUBLIC_ORIGIN;
  // req.protocol / req.host honor X-Forwarded-* only from proxies trusted via TRUST_PROXY
  const host = req.host || `localhost:${PORT}`;
  return `${req.protocol}://${host}`;
}
function isPrivateLanHost(hostname) {
  return /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})$/.test(hostname);
}
function detectEnvironment(req) {
  const host = req.host || `localhost:${PORT}`;
  const hostname = host.split(':')[0];
  const env = {
    isLocal: false,
    isDevTunnel: false,
    isProduction: false,
    hostname,
    port: PORT,
    nodeEnv: process.env.NODE_ENV || 'development'
  };
  if (hostname === 'localhost' || hostname === '127.0.0.1' || isPrivateLanHost(hostname)) {
    env.isLocal = true;
  }
  if (hostname.endsWith('.devtunnels.ms')) {
    env.isDevTunnel = true;
  }
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
app.post('/api/tickets', ticketCreationLimiter, (req, res) => {
  try {
    const { serviceType } = req.body || {};
    if (!serviceType) return res.status(400).json({ error: 'serviceType is required' });
    const createdAt = dayjs().toISOString();
    const number = getNextNumber(serviceType.toUpperCase());
    const info = db.prepare(`
      INSERT INTO tickets(serviceType, number, status, createdAt)
      VALUES (?, ?, 'waiting', ?)
    `).run(serviceType.toUpperCase(), number, createdAt);
    const ticket = db.prepare('SELECT * FROM tickets WHERE id=?').get(info.lastInsertRowid);
    emitQueueUpdate(serviceType.toUpperCase());
    res.json({ ticket });
  } catch (err) {
    console.error('Create ticket error:', isProdEnv ? err.message : (err && err.stack || err));
    res.status(500).json({ error: 'create failed' });
  }
});
app.get('/api/tickets/waiting', publicReadLimiter, (req, res) => {
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
app.get('/api/ticket/:id', publicReadLimiter, (req, res) => {
  const { id } = req.params;
  const row = db.prepare('SELECT * FROM tickets WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json({ ticket: publicTicket(row) });
});
app.get('/api/overview', publicReadLimiter, (req, res) => {
  res.json(getOverview());
});
function requireAgentAuth(req, res, next) {
  if (!req.session || !req.session.agent) {
    return res.status(401).json({ error: 'unauthorized - not logged in' });
  }
  const agent = db.prepare('SELECT * FROM agents WHERE id=? AND active=1').get(req.session.agent.id);
  if (!agent) {
    req.session.destroy();
    return res.status(401).json({ error: 'unauthorized - account disabled' });
  }
  req.session.agent = {
    id: agent.id,
    account: agent.account,
    name: agent.name,
    counter: agent.counter,
    role: agent.role
  };
  req.authenticatedAgent = agent;
  next();
}
function requireAdmin(req, res, next) {
  requireAgentAuth(req, res, () => {
    if (req.authenticatedAgent.role !== 'admin') {
      return res.status(403).json({ error: 'forbidden - admin only' });
    }
    next();
  });
}
app.use('/api/agent', adminAgentLimiter);
app.get('/api/agent/ticket/:id', requireAgentAuth, (req, res) => {
  const { id } = req.params;
  const row = db.prepare('SELECT * FROM tickets WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json({ ticket: row });
});
app.post('/api/agent/callNext', requireAgentAuth, (req, res) => {
  const { serviceType } = req.body || {};
  if (!serviceType) return res.status(400).json({ error: 'serviceType is required' });
  const ctr = String(req.authenticatedAgent.counter || '').trim();
  if (!ctr) return res.status(400).json({ error: 'counter not assigned' });
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
  io.emit('call:made', { ticket: publicTicket(updated) });
  emitQueueUpdate(serviceType.toUpperCase());
  res.json({ ticket: updated });
});
app.post('/api/agent/finish', requireAgentAuth, (req, res) => {
  const { ticketId, result } = req.body || {};
  if (!ticketId) return res.status(400).json({ error: 'ticketId is required' });
  const finishedAt = dayjs().toISOString();
  const row = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId);
  if (!row) return res.status(404).json({ error: 'not found' });
  db.prepare('UPDATE tickets SET status=?, finishedAt=?, result=? WHERE id=?')
    .run('finished', finishedAt, result || null, ticketId);
  const updated = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId);
  emitQueueUpdate(updated.serviceType);
  res.json({ ticket: updated });
});
app.post('/api/agent/markServing', requireAgentAuth, (req, res) => {
  const { ticketId } = req.body || {};
  if (!ticketId) return res.status(400).json({ error: 'ticketId is required' });
  const row = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId);
  if (!row) return res.status(404).json({ error: 'not found' });
  db.prepare('UPDATE tickets SET status=? WHERE id=?').run('serving', ticketId);
  const updated = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId);
  emitQueueUpdate(updated.serviceType);
  res.json({ ticket: updated });
});
app.post('/api/agent/recall', requireAgentAuth, (req, res) => {
  const { ticketId } = req.body || {};
  if (!ticketId) return res.status(400).json({ error: 'ticketId is required' });
  const row = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (!['called', 'serving'].includes(row.status)) return res.status(400).json({ error: 'not callable state' });
  const calledAt = dayjs().toISOString();
  db.prepare('UPDATE tickets SET calledAt=? WHERE id=?').run(calledAt, ticketId);
  const updated = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId);
  io.emit('call:made', { ticket: publicTicket(updated) });
  emitQueueUpdate(updated.serviceType);
  res.json({ ticket: updated });
});
app.post('/api/agent/cancel', requireAgentAuth, (req, res) => {
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
app.post('/api/agent/transfer', requireAgentAuth, (req, res) => {
  const { ticketId, toServiceType, toCounter, keepStatus } = req.body || {};
  if (!ticketId) return res.status(400).json({ error: 'ticketId is required' });
  const row = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId);
  if (!row) return res.status(404).json({ error: 'not found' });
  const targetType = (toServiceType || row.serviceType || '').toUpperCase();
  const status = keepStatus ? row.status : 'waiting';
  const calledAt = keepStatus ? row.calledAt : null;
  const counter = toCounter !== undefined ? toCounter : (keepStatus ? row.counter : null);
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
app.post('/api/agent/createTicket', requireAgentAuth, (req, res) => {
  try {
    const { serviceType } = req.body || {};
    if (!serviceType) return res.status(400).json({ error: 'serviceType is required' });
    const createdAt = dayjs().toISOString();
    const number = getNextNumber(serviceType.toUpperCase());
    const info = db.prepare(`
      INSERT INTO tickets(serviceType, number, status, createdAt)
      VALUES (?, ?, 'waiting', ?)
    `).run(serviceType.toUpperCase(), number, createdAt);
    const ticket = db.prepare('SELECT * FROM tickets WHERE id=?').get(info.lastInsertRowid);
    emitQueueUpdate(serviceType.toUpperCase());
    res.json({ ticket });
  } catch (err) {
    console.error('Agent create ticket error:', isProdEnv ? err.message : (err && err.stack || err));
    res.status(500).json({ error: 'create failed' });
  }
});
app.post('/api/agent/callSpecific', requireAgentAuth, (req, res) => {
  const { ticketId, internal } = req.body || {};
  if (!ticketId) return res.status(400).json({ error: 'ticketId is required' });
  const ctr = String(req.authenticatedAgent.counter || '').trim();
  if (!ctr) return res.status(400).json({ error: 'counter not assigned' });
  const busy = db.prepare("SELECT id FROM tickets WHERE counter=? AND status IN ('called','serving') LIMIT 1").get(ctr);
  if (busy && String(busy.id) !== String(ticketId)) return res.status(409).json({ error: 'counter busy', ticketId: busy.id });
  const row = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId);
  if (!row) return res.status(404).json({ error: 'not found' });
  const calledAt = dayjs().toISOString();
  db.prepare('UPDATE tickets SET status=?, calledAt=?, counter=? WHERE id=?')
    .run('called', calledAt, ctr, ticketId);
  const updated = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId);
  if (!internal) io.emit('call:made', { ticket: publicTicket(updated) });
  emitQueueUpdate(updated.serviceType);
  res.json({ ticket: updated });
});
app.get('/api/agent/history', requireAgentAuth, (req, res) => {
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
app.post('/api/agent/message', requireAgentAuth, (req, res) => {
  const { text, toCounter, toAgent } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text is required' });
  const sender = req.authenticatedAgent;
  const payload = { text, from: sender.name || sender.account, toCounter: toCounter || null, toAgent: toAgent || null, time: new Date().toISOString() };
  try {
    if (toCounter) {
      io.to(`counter:${String(toCounter)}`).emit('agent:message', payload);
      return res.json({ ok: true, targeted: 'counter', toCounter });
    }
    if (toAgent) {
      io.to(`agent:${String(toAgent)}`).emit('agent:message', payload);
      return res.json({ ok: true, targeted: 'agent', toAgent });
    }
    io.to('agents').emit('agent:message', payload);
    res.json({ ok: true });
  } catch (err) {
    console.error('Agent message error:', isProdEnv ? err.message : err);
    res.status(500).json({ error: 'message send failed' });
  }
});
app.get('/api/agent/profile', requireAgentAuth, (req, res) => {
  const agent = req.authenticatedAgent;
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
app.put('/api/agent/profile', requireAgentAuth, (req, res) => {
  const agent = req.authenticatedAgent;
  const { name, password } = req.body || {};
  const now = dayjs().toISOString();
  let hash = agent.password;
  if (password) {
    hash = bcrypt.hashSync(String(password), 10);
  }
  const updateName = name || agent.name;
  db.prepare('UPDATE agents SET name=?, password=?, updatedAt=? WHERE id=?')
    .run(updateName, hash, now, agent.id);
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
// Rooms an authenticated agent socket may join; anonymous sockets get none
function socketAgentRooms(socket) {
  const sess = socket.request.session;
  if (!sess || !sess.agent) return null;
  const agent = db.prepare('SELECT * FROM agents WHERE id=? AND active=1').get(sess.agent.id);
  if (!agent) return null;
  const rooms = ['agents', `agent:${agent.name || agent.account}`];
  if (agent.counter) rooms.push(`counter:${agent.counter}`);
  return rooms;
}
io.on('connection', (socket) => {
  const rooms = socketAgentRooms(socket);
  if (rooms) socket.join(rooms);
  socket.on('join', (room) => {
    const allowed = socketAgentRooms(socket);
    if (allowed && allowed.includes(String(room))) socket.join(String(room));
  });
  socket.on('leave', (room) => {
    try { socket.leave(String(room)); } catch (e) { /* noop */ }
  });
});
const args = process.argv.slice(2);
const hasHostFlag = args.includes('--host');
const bindHost = hasHostFlag ? '0.0.0.0' : 'localhost';
server.listen(PORT, bindHost, () => {
  const protocol = 'http';
  if (hasHostFlag) {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    const networkIps = [];
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if ((iface.family === 'IPv4' || iface.family === 4) && !iface.internal) {
          networkIps.push(iface.address);
        }
      }
    }
    console.log(`Server running on:`);
    console.log(`  - Local:   ${protocol}://localhost:${PORT}`);
    networkIps.forEach(ip => {
      console.log(`  - Network: ${protocol}://${ip}:${PORT}`);
    });
  } else {
    console.log(`Server running on ${protocol}://localhost:${PORT}`);
  }
});
app.use((err, req, res, next) => {
  const isJsonParseError = err && (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && err.status === 400 && 'body' in err));
  if (isJsonParseError) {
    if (!isProdEnv) {
      console.warn('⚠️  Received invalid JSON payload from', req.ip || req.get('x-forwarded-for') || req.connection.remoteAddress);
    }
    return res.status(400).json({ error: 'invalid JSON' });
  }
  next(err);
});
app.use((err, req, res, next) => {
  if (!err) return next();
  if (isProdEnv) {
    console.error('Unhandled error:', err.message || err);
    return res.status(500).json({ error: 'internal server error' });
  }
  console.error('Unhandled error (dev):', err && err.stack ? err.stack : err);
  res.status(500).json({ error: 'internal server error', details: err && err.message ? err.message : undefined });
});