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
// Service catalogue (e.g. A,B,C,D,E); ticket APIs accept only these codes
const SERVICE_TYPES = process.env.SERVICE_TYPES
  ? process.env.SERVICE_TYPES.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
  : [];
if (SERVICE_TYPES.length === 0) {
  console.error('\n⚠️  CRITICAL: SERVICE_TYPES is not set!');
  console.error('   Please set SERVICE_TYPES (comma-separated service codes, e.g. A,B,C,D,E) in your .env file.\n');
  process.exit(1);
}
// Upper bound on waiting tickets per service for anonymous ticket creation; staff createTicket is not capped
const MAX_WAITING_PER_SERVICE = Number(process.env.MAX_WAITING_PER_SERVICE);
if (!/^\d+$/.test(String(process.env.MAX_WAITING_PER_SERVICE)) || MAX_WAITING_PER_SERVICE < 1) {
  console.error('\n⚠️  CRITICAL: MAX_WAITING_PER_SERVICE is not set or is not a positive integer!');
  console.error('   Please set MAX_WAITING_PER_SERVICE (a positive integer, the maximum number of waiting tickets per service) in your .env file.\n');
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
  const requiredEnvVars = ['ALLOWED_ORIGINS', 'TRUST_PROXY', 'PUBLIC_ORIGIN'];
  const missing = requiredEnvVars.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error('\n⚠️  CRITICAL: Production environment requires the following environment variables:');
    missing.forEach(key => console.error(`   - ${key}`));
    console.error('\nPlease set these in your .env file or environment configuration.\n');
    process.exit(1);
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
  sessionVersion INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT
);
`);
  // Existing databases: add the column used to revoke sessions on password change / deactivation
  const agentColumns = db.prepare('PRAGMA table_info(agents)').all().map(c => c.name);
  if (!agentColumns.includes('sessionVersion')) {
    db.exec('ALTER TABLE agents ADD COLUMN sessionVersion INTEGER NOT NULL DEFAULT 0');
  }
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
// Ticket numbers restart every day, so waiting tickets from earlier days are void: expire them once per day
// before any queue read or write, otherwise they are called first and share numbers with today's tickets
const expireStaleWaitingStmt = db.prepare("UPDATE tickets SET status='canceled', finishedAt=?, result='expired' WHERE status='waiting' AND createdAt < ?");
let lastExpiryDay = null;
function expireStaleWaiting() {
  const today = dayjs().format('YYYYMMDD');
  if (lastExpiryDay === today) return;
  expireStaleWaitingStmt.run(dayjs().toISOString(), dayjs().startOf('day').toISOString());
  lastExpiryDay = today;
}
function isAllowedOrigin(origin) {
  if (!origin) return true;
  // Outside production ALLOWED_ORIGINS already contains http://localhost:PORT; other local ports must be listed
  // explicitly, because the session cookie is shared by every port of the same host
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
const sessionStore = new SQLiteStore({
  db: 'sessions.db',
  dir: './db'
});
const sessionMiddleware = session({
  store: sessionStore,
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
// Share the express-session with Socket.IO so staff sockets can be identified
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
// Map, not a plain object: client-supplied tokens must never resolve to inherited properties
const captchaStore = new Map();
const svgCaptcha = require('svg-captcha');
function genToken() { return crypto.randomBytes(16).toString('hex'); }
setInterval(() => {
  const now = Date.now();
  for (const [token, rec] of captchaStore) { if (rec.expiresAt < now) captchaStore.delete(token); }
}, 60 * 1000);
app.get('/api/captcha/new', captchaLimiter, (req, res) => {
  const token = genToken();
  const expiresAt = Date.now() + (5 * 60 * 1000);
  const captcha = svgCaptcha.create({ noise: 3, size: 6, color: true, background: '#f3f4f6', width: 160, height: 60 });
  captchaStore.set(token, { code: captcha.text, svg: captcha.data, expiresAt });
  res.json({ token, expiresAt });
});
app.get('/api/captcha/image/:token', captchaLimiter, async (req, res) => {
  const { token } = req.params;
  const rec = captchaStore.get(token);
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
  if (typeof captchaToken !== 'string' || typeof captcha !== 'string' || !captchaToken || !captcha) {
    return res.status(400).json({ error: 'captcha required' });
  }
  const rec = captchaStore.get(captchaToken);
  if (!rec || rec.expiresAt < Date.now()) return res.status(400).json({ error: 'invalid or expired captcha token' });
  captchaStore.delete(captchaToken);
  if (rec.code.toLowerCase() !== captcha.toLowerCase()) return res.status(400).json({ error: 'captcha mismatch' });
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
    req.session.agent = { ...agent, sessionVersion: user.sessionVersion };
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
  if ((name && isDisplayNameTaken(String(name), null)) || db.prepare('SELECT 1 FROM agents WHERE name=?').get(String(account))) {
    return res.status(400).json({ error: 'name already in use' });
  }
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
  if (name && isDisplayNameTaken(String(name), existing.id)) return res.status(400).json({ error: 'name already in use' });
  const hash = password ? bcrypt.hashSync(String(password), 10) : existing.password;
  const newRole = role === undefined ? existing.role : (role || null);
  const newActive = active === undefined ? existing.active : active;
  // A password reset or deactivation revokes the account's existing sessions
  const revokeSessions = Boolean(password) || Number(newActive) !== 1;
  db.prepare('UPDATE agents SET name=?, password=?, counter=?, role=?, active=?, sessionVersion=sessionVersion+?, updatedAt=? WHERE id=?')
    .run(name || existing.name, hash, counter || existing.counter, newRole, newActive, revokeSessions ? 1 : 0, now, id);
  if (revokeSessions && existing.id === req.authenticatedAgent.id && Number(newActive) === 1) {
    // Keep the admin's current session valid after resetting their own password
    req.session.agent.sessionVersion = db.prepare('SELECT sessionVersion FROM agents WHERE id=?').get(existing.id).sessionVersion;
  }
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
// Overview covers configured service codes only, so legacy rows with other codes are not broadcast
const serviceTypePlaceholders = SERVICE_TYPES.map(() => '?').join(',');
function getOverview() {
  expireStaleWaiting();
  const rows = db.prepare(`
    SELECT serviceType,
           SUM(CASE WHEN status='waiting' THEN 1 ELSE 0 END) AS waiting,
           SUM(CASE WHEN status='called' THEN 1 ELSE 0 END) AS called,
           SUM(CASE WHEN status='serving' THEN 1 ELSE 0 END) AS serving,
           SUM(CASE WHEN status='finished' THEN 1 ELSE 0 END) AS finished
    FROM tickets
    WHERE serviceType IN (${serviceTypePlaceholders})
    GROUP BY serviceType
  `).all(...SERVICE_TYPES);
  const currentCalls = db.prepare(`
    SELECT id, serviceType, number, counter, calledAt
    FROM tickets
    WHERE status IN ('called','serving')
      AND serviceType IN (${serviceTypePlaceholders})
    ORDER BY calledAt DESC
    LIMIT 50
  `).all(...SERVICE_TYPES);
  return { summary: rows, currentCalls };
}
function normalizeServiceType(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return SERVICE_TYPES.includes(code) ? code : null;
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
    // publicOrigin may be request-derived outside production; never let a shared cache store it
    res.setHeader('Cache-Control', 'no-store');
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
    const serviceType = normalizeServiceType((req.body || {}).serviceType);
    if (!serviceType) return res.status(400).json({ error: 'invalid serviceType' });
    expireStaleWaiting();
    // The per-IP rate limit bounds speed only; this bounds how many unserved tickets anonymous clients can queue
    const waiting = db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE serviceType=? AND status='waiting'").get(serviceType).n;
    if (waiting >= MAX_WAITING_PER_SERVICE) return res.status(429).json({ error: 'queue is full, please try later' });
    const createdAt = dayjs().toISOString();
    const number = getNextNumber(serviceType);
    const info = db.prepare(`
      INSERT INTO tickets(serviceType, number, status, createdAt)
      VALUES (?, ?, 'waiting', ?)
    `).run(serviceType, number, createdAt);
    const ticket = db.prepare('SELECT * FROM tickets WHERE id=?').get(info.lastInsertRowid);
    emitQueueUpdate(serviceType);
    res.json({ ticket });
  } catch (err) {
    console.error('Create ticket error:', isProdEnv ? err.message : (err && err.stack || err));
    res.status(500).json({ error: 'create failed' });
  }
});
app.get('/api/tickets/waiting', publicReadLimiter, (req, res) => {
  let serviceTypes = SERVICE_TYPES;
  if (req.query.serviceType !== undefined) {
    const serviceType = normalizeServiceType(req.query.serviceType);
    if (!serviceType) return res.status(400).json({ error: 'invalid serviceType' });
    serviceTypes = [serviceType];
  }
  expireStaleWaiting();
  const rows = db.prepare(`
    SELECT id, serviceType, number, status, createdAt
    FROM tickets
    WHERE status='waiting'
      AND serviceType IN (${serviceTypes.map(() => '?').join(',')})
    ORDER BY createdAt ASC
  `).all(...serviceTypes);
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
// Agent row for a session that is still valid: account active and no password reset / deactivation since login
function loadSessionAgent(sess) {
  if (!sess || !sess.agent) return null;
  const agent = db.prepare('SELECT * FROM agents WHERE id=? AND active=1').get(sess.agent.id);
  if (!agent || agent.sessionVersion !== sess.agent.sessionVersion) return null;
  return agent;
}
// Display names (name, or account when unnamed) address direct messages, so they must be unique
function isDisplayNameTaken(value, exceptId) {
  return !!db.prepare('SELECT 1 FROM agents WHERE id IS NOT ? AND (name=? OR account=?)').get(exceptId, value, value);
}
function requireAgentAuth(req, res, next) {
  if (!req.session || !req.session.agent) {
    return res.status(401).json({ error: 'unauthorized - not logged in' });
  }
  const agent = loadSessionAgent(req.session);
  if (!agent) {
    req.session.destroy();
    return res.status(401).json({ error: 'unauthorized - session revoked' });
  }
  req.session.agent = {
    id: agent.id,
    account: agent.account,
    name: agent.name,
    counter: agent.counter,
    role: agent.role,
    sessionVersion: agent.sessionVersion
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
// Statuses each agent action may start from; finished/canceled tickets are closed and immutable
const TICKET_ACTION_FROM = {
  callSpecific: ['waiting', 'called', 'serving'],
  markServing: ['called', 'serving'],
  finish: ['called', 'serving'],
  cancel: ['waiting', 'called', 'serving'],
  transfer: ['waiting', 'called', 'serving']
};
function rejectTicketTransition(action, row, res) {
  if (TICKET_ACTION_FROM[action].includes(row.status)) return false;
  res.status(409).json({ error: 'invalid ticket state', status: row.status });
  return true;
}
app.use('/api/agent', adminAgentLimiter);
app.get('/api/agent/ticket/:id', requireAgentAuth, (req, res) => {
  const { id } = req.params;
  const row = db.prepare('SELECT * FROM tickets WHERE id=?').get(id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json({ ticket: row });
});
app.post('/api/agent/callNext', requireAgentAuth, (req, res) => {
  const serviceType = normalizeServiceType((req.body || {}).serviceType);
  if (!serviceType) return res.status(400).json({ error: 'invalid serviceType' });
  const ctr = String(req.authenticatedAgent.counter || '').trim();
  if (!ctr) return res.status(400).json({ error: 'counter not assigned' });
  const busy = db.prepare("SELECT id FROM tickets WHERE counter=? AND status IN ('called','serving') LIMIT 1").get(ctr);
  if (busy) return res.status(409).json({ error: 'counter busy', ticketId: busy.id });
  expireStaleWaiting();
  const ticket = db.prepare(`
    SELECT * FROM tickets
    WHERE serviceType=? AND status='waiting'
    ORDER BY createdAt ASC
    LIMIT 1
  `).get(serviceType);
  if (!ticket) return res.status(404).json({ error: 'no waiting ticket' });
  const calledAt = dayjs().toISOString();
  db.prepare('UPDATE tickets SET status=?, calledAt=?, counter=? WHERE id=?')
    .run('called', calledAt, ctr, ticket.id);
  const updated = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticket.id);
  io.emit('call:made', { ticket: publicTicket(updated) });
  emitQueueUpdate(serviceType);
  res.json({ ticket: updated });
});
app.post('/api/agent/finish', requireAgentAuth, (req, res) => {
  const { ticketId, result } = req.body || {};
  if (!ticketId) return res.status(400).json({ error: 'ticketId is required' });
  const finishedAt = dayjs().toISOString();
  const row = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (rejectTicketTransition('finish', row, res)) return;
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
  if (rejectTicketTransition('markServing', row, res)) return;
  if (!row.counter) return res.status(409).json({ error: 'ticket not called to a counter' });
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
  if (rejectTicketTransition('cancel', row, res)) return;
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
  if (rejectTicketTransition('transfer', row, res)) return;
  const targetType = toServiceType ? normalizeServiceType(toServiceType) : row.serviceType;
  if (!targetType) return res.status(400).json({ error: 'invalid serviceType' });
  // The public counter label may only be a counter an admin assigned to an active account (same rule as
  // callNext/callSpecific), normalized the same way so the counter-busy check cannot be bypassed
  let requestedCounter = null;
  if (toCounter !== undefined) {
    if (typeof toCounter !== 'string' || !toCounter.trim()) return res.status(400).json({ error: 'invalid counter' });
    requestedCounter = toCounter.trim();
    const assigned = db.prepare('SELECT 1 FROM agents WHERE active=1 AND TRIM(counter)=? LIMIT 1').get(requestedCounter);
    if (!assigned) return res.status(400).json({ error: 'unknown counter' });
  }
  const status = keepStatus ? row.status : 'waiting';
  const calledAt = keepStatus ? row.calledAt : null;
  const counter = requestedCounter !== null ? requestedCounter : (keepStatus ? row.counter : null);
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
    const serviceType = normalizeServiceType((req.body || {}).serviceType);
    if (!serviceType) return res.status(400).json({ error: 'invalid serviceType' });
    const createdAt = dayjs().toISOString();
    const number = getNextNumber(serviceType);
    const info = db.prepare(`
      INSERT INTO tickets(serviceType, number, status, createdAt)
      VALUES (?, ?, 'waiting', ?)
    `).run(serviceType, number, createdAt);
    const ticket = db.prepare('SELECT * FROM tickets WHERE id=?').get(info.lastInsertRowid);
    emitQueueUpdate(serviceType);
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
  expireStaleWaiting();
  const row = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (rejectTicketTransition('callSpecific', row, res)) return;
  const calledAt = dayjs().toISOString();
  db.prepare('UPDATE tickets SET status=?, calledAt=?, counter=? WHERE id=?')
    .run('called', calledAt, ctr, ticketId);
  const updated = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId);
  if (!internal) io.emit('call:made', { ticket: publicTicket(updated) });
  emitQueueUpdate(updated.serviceType);
  res.json({ ticket: updated });
});
app.get('/api/agent/history', requireAgentAuth, (req, res) => {
  // A negative LIMIT means "no limit" in SQLite, so accept only decimal digits and clamp to 1..500
  const rawLimit = req.query.limit === undefined ? '100' : req.query.limit;
  if (typeof rawLimit !== 'string' || !/^\d+$/.test(rawLimit)) return res.status(400).json({ error: 'invalid limit' });
  const limit = Math.min(Math.max(parseInt(rawLimit, 10), 1), 500);
  let serviceType = null;
  if (req.query.serviceType !== undefined) {
    serviceType = normalizeServiceType(req.query.serviceType);
    if (!serviceType) return res.status(400).json({ error: 'invalid serviceType' });
  }
  const rows = db.prepare(`
    SELECT * FROM tickets
    WHERE status IN ('finished','canceled')
      ${serviceType ? 'AND serviceType=?' : ''}
    ORDER BY COALESCE(finishedAt, calledAt, createdAt) DESC
    LIMIT ?
  `).all(...(serviceType ? [serviceType, limit] : [limit]));
  res.json({ tickets: rows });
});
app.post('/api/agent/message', requireAgentAuth, async (req, res) => {
  const { text, toCounter, toAgent } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text is required' });
  const sender = req.authenticatedAgent;
  const payload = { text, from: sender.name || sender.account, toCounter: toCounter || null, toAgent: toAgent || null, time: new Date().toISOString() };
  try {
    if (toCounter) {
      const ctr = String(toCounter);
      await emitToAgents('agent:message', payload, (agent) => agent.counter === ctr);
      return res.json({ ok: true, targeted: 'counter', toCounter });
    }
    if (toAgent) {
      // Resolve the display name to one agent id now; delivery never trusts a name-keyed room
      const targets = db.prepare("SELECT id FROM agents WHERE active=1 AND COALESCE(NULLIF(name, ''), account)=?").all(String(toAgent));
      if (targets.length === 0) return res.status(404).json({ error: 'agent not found' });
      if (targets.length > 1) return res.status(409).json({ error: 'ambiguous agent name' });
      const targetId = targets[0].id;
      await emitToAgents('agent:message', payload, (agent) => agent.id === targetId);
      return res.json({ ok: true, targeted: 'agent', toAgent });
    }
    await emitToAgents('agent:message', payload, () => true);
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
  const { name, password, currentPassword } = req.body || {};
  if (name && isDisplayNameTaken(String(name), agent.id)) return res.status(400).json({ error: 'name already in use' });
  const now = dayjs().toISOString();
  let hash = agent.password;
  if (password) {
    // Replacing the long-term credential needs proof of the current one, not only a live session
    if (typeof password !== 'string' || typeof currentPassword !== 'string' ||
        !bcrypt.compareSync(currentPassword, String(agent.password))) {
      return res.status(403).json({ error: 'current password required' });
    }
    hash = bcrypt.hashSync(password, 10);
  }
  const updateName = name || agent.name;
  // A password change revokes the account's other sessions; the current session is kept valid below
  db.prepare('UPDATE agents SET name=?, password=?, sessionVersion=sessionVersion+?, updatedAt=? WHERE id=?')
    .run(updateName, hash, password ? 1 : 0, now, agent.id);
  const updated = db.prepare('SELECT id, account, name, counter, role, active, createdAt, updatedAt, sessionVersion FROM agents WHERE id=?').get(agent.id);
  req.session.agent.sessionVersion = updated.sessionVersion;
  const { sessionVersion, ...safeAgent } = updated;
  res.json({ agent: safeAgent });
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
function loadStoredSession(sessionId) {
  return new Promise((resolve) => {
    sessionStore.get(sessionId, (err, sess) => resolve(err ? null : sess));
  });
}
// Staff sockets are tracked in one room. Each delivery re-reads the socket's session and current
// account, so logout, deactivation, deletion, password reset, rename and counter changes apply immediately.
async function emitToAgents(event, payload, matches) {
  const sockets = await io.in('agents').fetchSockets();
  for (const s of sockets) {
    const sess = await loadStoredSession(s.data.sessionId);
    const agent = loadSessionAgent(sess);
    if (!agent) {
      s.leave('agents');
      continue;
    }
    if (matches(agent)) s.emit(event, payload);
  }
}
io.on('connection', (socket) => {
  const sess = socket.request.session;
  if (loadSessionAgent(sess)) {
    socket.data.sessionId = sess.id;
    socket.join('agents');
  }
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