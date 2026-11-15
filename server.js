const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const session = require('express-session');
const helmet = require('helmet');
const QRCode = require('qrcode');
const sharp = require('sharp');
const svgCaptcha = require('svg-captcha');
const { openDatabase } = require('./lib/sqlite');
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
function isValidTimeZone(zone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch (err) {
    return false;
  }
}
if (!process.env.TZ || !isValidTimeZone(process.env.TZ)) {
  console.error('\n⚠️  CRITICAL: TZ is not set or is not a valid IANA time zone!');
  console.error('   Please set TZ (the business time zone that decides when ticket numbers restart, e.g. Asia/Taipei) in your .env file.\n');
  process.exit(1);
}
function requirePositiveInteger(name, description) {
  const raw = process.env[name];
  if (!/^\d+$/.test(String(raw)) || Number(raw) < 1) {
    console.error(`\n⚠️  CRITICAL: ${name} is not set or is not a positive integer!`);
    console.error(`   Please set ${name} (${description}) in your .env file.\n`);
    process.exit(1);
  }
  return Number(raw);
}
const SERVICE_TYPES = process.env.SERVICE_TYPES
  ? process.env.SERVICE_TYPES.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
  : [];
if (SERVICE_TYPES.length === 0) {
  console.error('\n⚠️  CRITICAL: SERVICE_TYPES is not set!');
  console.error('   Please set SERVICE_TYPES (comma-separated service codes, e.g. A,B,C,D,E) in your .env file.\n');
  process.exit(1);
}
if (SERVICE_TYPES.some(code => !/^[A-Z0-9]+$/.test(code))) {
  console.error('\n⚠️  CRITICAL: SERVICE_TYPES may only contain letters and digits (e.g. A,B,C,D,E).\n');
  process.exit(1);
}
const missingServiceVars = SERVICE_TYPES
  .flatMap(code => [`SERVICE_NAME_${code}`, `SERVICE_DESC_${code}`])
  .filter(key => !process.env[key] || !process.env[key].trim());
if (missingServiceVars.length > 0) {
  console.error('\n⚠️  CRITICAL: Every service code needs a display name and a description:');
  missingServiceVars.forEach(key => console.error(`   - ${key}`));
  console.error('\nPlease set these in your .env file.\n');
  process.exit(1);
}
const SERVICES = SERVICE_TYPES.map(code => ({
  code,
  name: process.env[`SERVICE_NAME_${code}`].trim(),
  description: process.env[`SERVICE_DESC_${code}`].trim()
}));
const MAX_WAITING_PER_SERVICE = requirePositiveInteger('MAX_WAITING_PER_SERVICE', 'the maximum number of waiting tickets per service');
const MAX_WAITING_PER_CLIENT = requirePositiveInteger('MAX_WAITING_PER_CLIENT', 'the maximum number of waiting tickets one client IP may hold');
if (process.env.KIOSK_IPS === undefined) {
  console.error('\n⚠️  CRITICAL: KIOSK_IPS is not set!');
  console.error('   Please set KIOSK_IPS (comma-separated kiosk device IPs exempt from MAX_WAITING_PER_CLIENT; an empty value means none) in your .env file.\n');
  process.exit(1);
}
const KIOSK_IPS = process.env.KIOSK_IPS.split(',').map(s => s.trim()).filter(Boolean);
if (!process.env.DB_DIR) {
  console.error('\n⚠️  CRITICAL: DB_DIR is not set!');
  console.error('   Please set DB_DIR (directory for queue.db and sessions.db, relative to the project root or absolute) in your .env file.\n');
  process.exit(1);
}
const DB_DIR = path.resolve(__dirname, process.env.DB_DIR);
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
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ? process.env.PUBLIC_ORIGIN.trim().replace(/\/$/, '') : null;
if (PUBLIC_ORIGIN && !ALLOWED_ORIGINS.includes(PUBLIC_ORIGIN)) {
  ALLOWED_ORIGINS.push(PUBLIC_ORIGIN);
}
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
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
const dbPath = path.join(DB_DIR, 'queue.db');
const db = openDatabase(dbPath);
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
  finishedAt TEXT,
  clientKey TEXT
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
const ticketColumns = db.prepare('PRAGMA table_info(tickets)').all().map(c => c.name);
if (!ticketColumns.includes('clientKey')) {
  db.exec('ALTER TABLE tickets ADD COLUMN clientKey TEXT');
}
db.exec(`
CREATE INDEX IF NOT EXISTS idx_tickets_status_service ON tickets(status, serviceType, createdAt);
CREATE INDEX IF NOT EXISTS idx_tickets_counter_status ON tickets(counter, status);
CREATE INDEX IF NOT EXISTS idx_tickets_client_status ON tickets(clientKey, status);
`);
const TICKET_COLUMNS = 'id, serviceType, number, status, counter, result, createdAt, calledAt, finishedAt';
const selectTicketStmt = db.prepare(`SELECT ${TICKET_COLUMNS} FROM tickets WHERE id=?`);
function getTicket(id) {
  return selectTicketStmt.get(id);
}
function localDayKey(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}
const getNextNumber = db.transaction((serviceType) => {
  const ymd = localDayKey(new Date());
  const row = db.prepare('SELECT seq FROM seq WHERE serviceType=? AND ymd=?').get(serviceType, ymd);
  let next;
  if (row) {
    next = row.seq + 1;
    db.prepare('UPDATE seq SET seq=? WHERE serviceType=? AND ymd=?').run(next, serviceType, ymd);
  } else {
    next = 1;
    db.prepare('INSERT INTO seq(serviceType, ymd, seq) VALUES (?, ?, ?)').run(serviceType, ymd, next);
  }
  return `${serviceType}${String(next).padStart(3, '0')}`;
});
const insertTicketStmt = db.prepare("INSERT INTO tickets(serviceType, number, status, createdAt, clientKey) VALUES (?, ?, 'waiting', ?, ?)");
function createTicket(serviceType, clientKey) {
  const info = insertTicketStmt.run(serviceType, getNextNumber(serviceType), new Date().toISOString(), clientKey);
  return getTicket(info.lastInsertRowid);
}
const expireStaleTicketsStmt = db.prepare("UPDATE tickets SET status='canceled', finishedAt=?, result='expired' WHERE status IN ('waiting','called','serving') AND createdAt < ?");
let lastExpiryDay = null;
function expireStaleTickets() {
  const now = new Date();
  const today = localDayKey(now);
  if (lastExpiryDay === today) return;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  expireStaleTicketsStmt.run(now.toISOString(), startOfToday.toISOString());
  lastExpiryDay = today;
}
function isAllowedOrigin(origin, host) {
  if (!origin) return true;
  const normalizedOrigin = origin.replace(/\/$/, '');
  if (ALLOWED_ORIGINS.includes(normalizedOrigin)) return true;
  try {
    return new URL(normalizedOrigin).host === host;
  } catch (err) {
    return false;
  }
}
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
  allowRequest: (req, cb) => {
    const origin = req.headers.origin;
    if (isAllowedOrigin(origin, req.headers.host)) return cb(null, true);
    console.warn(`⚠️  Socket.IO blocked: ${origin} (not in allowlist)`);
    return cb('origin not allowed', false);
  }
});
app.use(cors((req, cb) => {
  const origin = req.get('origin');
  if (isAllowedOrigin(origin, req.get('host'))) return cb(null, { origin: true, credentials: true });
  console.warn(`⚠️  CORS blocked: ${origin} (not in allowlist)`);
  const err = new Error('origin not allowed');
  err.status = 403;
  err.expose = true;
  return cb(err);
}));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
const SQLiteStore = require('./lib/session-store')(session);
const sessionStore = new SQLiteStore({
  db: 'sessions.db',
  dir: DB_DIR
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
io.engine.use(sessionMiddleware);
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
  if (req.path === '/api/tickets' || req.path === '/api/login') return next();
  return csrfProtection(req, res, next);
}
app.use(conditionalCsrf);
const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'"],
  imgSrc: ["'self'", "data:", "blob:"],
  fontSrc: ["'self'", "data:"],
  connectSrc: ["'self'", "ws:", "wss:"],
  upgradeInsecureRequests: null
};
function securityHeaders(frameAncestors, xFrameOptions) {
  return helmet({
    contentSecurityPolicy: { directives: { ...cspDirectives, frameAncestors } },
    xFrameOptions
  });
}
const pageSecurityHeaders = securityHeaders(["'self'"], { action: 'sameorigin' });
const embeddableSecurityHeaders = securityHeaders(["'self'", ...ALLOWED_ORIGINS], false);
app.use((req, res, next) => {
  const headers = /^\/kiosk(\/|$)/.test(req.path) ? embeddableSecurityHeaders : pageSecurityHeaders;
  headers(req, res, next);
});
function limiter(windowMs, max, error, options) {
  return rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false, message: { error }, ...options });
}
const loginLimiter = limiter(10 * 60 * 1000, 30, 'too many login attempts, please try later');
const captchaLimiter = limiter(5 * 60 * 1000, 60, 'too many captcha requests, please try later');
const qrcodeLimiter = limiter(60 * 1000, 60, 'too many qrcode requests, please try later');
const adminAgentLimiter = limiter(60 * 1000, 120, 'too many requests, please try later');
const ticketCreationLimiter = limiter(60 * 1000, 60, 'too many ticket creations, please try later');
const publicReadLimiter = limiter(60 * 1000, 120, 'too many requests, please try later');
const staticLimiter = limiter(60 * 1000, 300, 'too many requests, please try later', { skip: (req) => req.path.startsWith('/api') });
const captchaStore = new Map();
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
  const rec = captchaStore.get(req.params.token);
  if (!rec || rec.expiresAt < Date.now()) return res.status(404).send('invalid token');
  try {
    const png = await sharp(Buffer.from(rec.svg, 'utf8')).png().toBuffer();
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(png);
  } catch (err) {
    console.error('Captcha image generation error:', isProdEnv ? err.message : err);
    res.status(500).send('captcha error');
  }
});
app.post('/api/login', loginLimiter, async (req, res) => {
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
  const ok = (user.password && password) ? await bcrypt.compare(String(password), String(user.password)) : false;
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
app.post('/api/agents', requireAdmin, async (req, res) => {
  const { account, name, password, counter, role } = req.body || {};
  if (!account || !password) return res.status(400).json({ error: 'account and password required' });
  if ((name && isDisplayNameTaken(String(name), null)) || db.prepare('SELECT 1 FROM agents WHERE name=?').get(String(account))) {
    return res.status(400).json({ error: 'name already in use' });
  }
  const hash = await bcrypt.hash(String(password), 10);
  try {
    const info = db.prepare('INSERT INTO agents(account,name,password,counter,role,createdAt) VALUES (?,?,?,?,?,?)').run(account, name || null, hash, counter || null, role || null, new Date().toISOString());
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
app.put('/api/agents/:id', requireAdmin, async (req, res) => {
  const id = req.params.id;
  const { name, password, counter, role, active } = req.body || {};
  const newHash = password ? await bcrypt.hash(String(password), 10) : null;
  const existing = db.prepare('SELECT * FROM agents WHERE id=?').get(id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  if (name && isDisplayNameTaken(String(name), existing.id)) return res.status(400).json({ error: 'name already in use' });
  const hash = newHash || existing.password;
  const newName = name === undefined ? existing.name : (name || null);
  const newCounter = counter === undefined ? existing.counter : (counter || null);
  const newRole = role === undefined ? existing.role : (role || null);
  const newActive = active === undefined ? existing.active : (Number(active) === 1 ? 1 : 0);
  if (!newName && db.prepare('SELECT 1 FROM agents WHERE id IS NOT ? AND name=?').get(existing.id, existing.account)) {
    return res.status(400).json({ error: 'name already in use' });
  }
  if (existing.id === req.authenticatedAgent.id && (newRole !== 'admin' || newActive !== 1)) {
    return res.status(400).json({ error: 'cannot demote or deactivate your own account' });
  }
  const revokeSessions = Boolean(password) || Number(newActive) !== 1;
  db.prepare('UPDATE agents SET name=?, password=?, counter=?, role=?, active=?, sessionVersion=sessionVersion+?, updatedAt=? WHERE id=?')
    .run(newName, hash, newCounter, newRole, newActive, revokeSessions ? 1 : 0, new Date().toISOString(), id);
  if (revokeSessions && existing.id === req.authenticatedAgent.id && Number(newActive) === 1) {
    req.session.agent.sessionVersion = db.prepare('SELECT sessionVersion FROM agents WHERE id=?').get(existing.id).sessionVersion;
  }
  const row = db.prepare('SELECT id, account, name, counter, role, active, createdAt, updatedAt FROM agents WHERE id=?').get(id);
  res.json({ agent: row });
});
app.delete('/api/agents/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  if (Number(id) === req.authenticatedAgent.id) return res.status(400).json({ error: 'cannot delete your own account' });
  db.prepare('DELETE FROM agents WHERE id=?').run(id);
  res.json({ ok: true });
});
app.use(staticLimiter);
app.use(express.static(path.join(__dirname, 'public')));
function emitQueueUpdate(serviceType) {
  const overview = getOverview();
  io.emit('queue:update', { serviceType, overview });
}
function publicTicket(row) {
  if (!row) return row;
  const { id, serviceType, number, status, counter, createdAt, calledAt, finishedAt } = row;
  return { id, serviceType, number, status, counter, createdAt, calledAt, finishedAt };
}
const serviceTypePlaceholders = SERVICE_TYPES.map(() => '?').join(',');
const selectWaitingStmt = db.prepare(`
  SELECT id, serviceType, number, createdAt
  FROM tickets
  WHERE status='waiting'
    AND serviceType IN (${serviceTypePlaceholders})
  ORDER BY createdAt ASC, id ASC
`);
const selectCurrentCallsStmt = db.prepare(`
  SELECT id, serviceType, number, status, counter, calledAt
  FROM tickets
  WHERE status IN ('called','serving')
    AND serviceType IN (${serviceTypePlaceholders})
  ORDER BY calledAt DESC
  LIMIT 50
`);
function getOverview() {
  expireStaleTickets();
  const waiting = Object.fromEntries(SERVICE_TYPES.map(code => [code, []]));
  for (const row of selectWaitingStmt.all(...SERVICE_TYPES)) {
    waiting[row.serviceType].push({ id: row.id, number: row.number, createdAt: row.createdAt });
  }
  const summary = SERVICE_TYPES.map(code => ({ serviceType: code, waiting: waiting[code].length }));
  const currentCalls = selectCurrentCallsStmt.all(...SERVICE_TYPES);
  return { summary, waiting, currentCalls };
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
  return `${req.protocol}://${req.host}`;
}
function ticketUrlFor(req, ticketId) {
  return `${inferPublicOrigin(req)}/ticket/index.html?id=${ticketId}`;
}
app.get('/api/config', (req, res) => {
  res.json({ services: SERVICES });
});
function clientKeyFor(req) {
  if (KIOSK_IPS.includes(ipKeyGenerator(String(req.ip), false))) return null;
  return crypto.createHmac('sha256', SESSION_SECRET).update(ipKeyGenerator(String(req.ip))).digest('hex');
}
const countWaitingStmt = db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE serviceType=? AND status='waiting'");
const countClientWaitingStmt = db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE clientKey=? AND status='waiting'");
app.post('/api/tickets', ticketCreationLimiter, (req, res) => {
  const serviceType = normalizeServiceType((req.body || {}).serviceType);
  if (!serviceType) return res.status(400).json({ error: 'invalid serviceType' });
  expireStaleTickets();
  const clientKey = clientKeyFor(req);
  if (clientKey && countClientWaitingStmt.get(clientKey).n >= MAX_WAITING_PER_CLIENT) {
    return res.status(429).json({ error: 'too many waiting tickets from this network' });
  }
  if (countWaitingStmt.get(serviceType).n >= MAX_WAITING_PER_SERVICE) return res.status(429).json({ error: 'queue is full, please try later' });
  const ticket = createTicket(serviceType, clientKey);
  emitQueueUpdate(serviceType);
  res.json({ ticket: publicTicket(ticket), ticketUrl: ticketUrlFor(req, ticket.id) });
});
app.get('/api/ticket/:id', publicReadLimiter, (req, res) => {
  const row = getTicket(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json({ ticket: publicTicket(row) });
});
app.get('/api/overview', publicReadLimiter, (req, res) => {
  res.json(getOverview());
});
function loadSessionAgent(sess) {
  if (!sess || !sess.agent) return null;
  const agent = db.prepare('SELECT * FROM agents WHERE id=? AND active=1').get(sess.agent.id);
  if (!agent || agent.sessionVersion !== sess.agent.sessionVersion) return null;
  return agent;
}
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
const TICKET_ACTION_FROM = {
  callSpecific: ['waiting', 'called', 'serving'],
  markServing: ['called', 'serving'],
  recall: ['called', 'serving'],
  finish: ['called', 'serving'],
  cancel: ['waiting', 'called', 'serving'],
  transfer: ['waiting', 'called', 'serving']
};
function rejectTicketTransition(action, row, res) {
  if (TICKET_ACTION_FROM[action].includes(row.status)) return false;
  res.status(409).json({ error: 'invalid ticket state', status: row.status });
  return true;
}
function agentCounter(agent) {
  return String(agent.counter || '').trim();
}
function rejectForeignTicket(agent, row, res) {
  if (agent.role === 'admin' || !['called', 'serving'].includes(row.status)) return false;
  if (row.counter === agentCounter(agent)) return false;
  res.status(403).json({ error: 'ticket belongs to another counter' });
  return true;
}
function isOptionalNote(value) {
  return value === undefined || value === null || typeof value === 'string';
}
const selectBusyCounterStmt = db.prepare("SELECT id FROM tickets WHERE counter=? AND status IN ('called','serving') LIMIT 1");
app.use('/api/agent', adminAgentLimiter);
app.get('/api/agent/ticket/:id', requireAgentAuth, (req, res) => {
  const row = getTicket(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json({ ticket: row });
});
app.post('/api/agent/callNext', requireAgentAuth, (req, res) => {
  const serviceType = normalizeServiceType((req.body || {}).serviceType);
  if (!serviceType) return res.status(400).json({ error: 'invalid serviceType' });
  const ctr = agentCounter(req.authenticatedAgent);
  if (!ctr) return res.status(400).json({ error: 'counter not assigned' });
  expireStaleTickets();
  const busy = selectBusyCounterStmt.get(ctr);
  if (busy) return res.status(409).json({ error: 'counter busy', ticketId: busy.id });
  const next = db.prepare(`
    SELECT id FROM tickets
    WHERE serviceType=? AND status='waiting'
    ORDER BY createdAt ASC, id ASC
    LIMIT 1
  `).get(serviceType);
  if (!next) return res.status(404).json({ error: 'no waiting ticket' });
  db.prepare('UPDATE tickets SET status=?, calledAt=?, counter=? WHERE id=?')
    .run('called', new Date().toISOString(), ctr, next.id);
  const updated = getTicket(next.id);
  io.emit('call:made', { ticket: publicTicket(updated) });
  emitQueueUpdate(serviceType);
  res.json({ ticket: updated });
});
app.post('/api/agent/finish', requireAgentAuth, (req, res) => {
  const { ticketId, result } = req.body || {};
  if (!ticketId) return res.status(400).json({ error: 'ticketId is required' });
  if (!isOptionalNote(result)) return res.status(400).json({ error: 'result must be text' });
  const row = getTicket(ticketId);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (rejectTicketTransition('finish', row, res)) return;
  if (rejectForeignTicket(req.authenticatedAgent, row, res)) return;
  db.prepare('UPDATE tickets SET status=?, finishedAt=?, result=? WHERE id=?')
    .run('finished', new Date().toISOString(), result || null, row.id);
  const updated = getTicket(row.id);
  emitQueueUpdate(updated.serviceType);
  res.json({ ticket: updated });
});
app.post('/api/agent/markServing', requireAgentAuth, (req, res) => {
  const { ticketId } = req.body || {};
  if (!ticketId) return res.status(400).json({ error: 'ticketId is required' });
  const row = getTicket(ticketId);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (rejectTicketTransition('markServing', row, res)) return;
  if (!row.counter) return res.status(409).json({ error: 'ticket not called to a counter' });
  if (rejectForeignTicket(req.authenticatedAgent, row, res)) return;
  db.prepare('UPDATE tickets SET status=? WHERE id=?').run('serving', row.id);
  const updated = getTicket(row.id);
  emitQueueUpdate(updated.serviceType);
  res.json({ ticket: updated });
});
app.post('/api/agent/recall', requireAgentAuth, (req, res) => {
  const { ticketId } = req.body || {};
  if (!ticketId) return res.status(400).json({ error: 'ticketId is required' });
  const row = getTicket(ticketId);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (rejectTicketTransition('recall', row, res)) return;
  if (rejectForeignTicket(req.authenticatedAgent, row, res)) return;
  db.prepare('UPDATE tickets SET calledAt=? WHERE id=?').run(new Date().toISOString(), row.id);
  const updated = getTicket(row.id);
  io.emit('call:made', { ticket: publicTicket(updated) });
  emitQueueUpdate(updated.serviceType);
  res.json({ ticket: updated });
});
app.post('/api/agent/cancel', requireAgentAuth, (req, res) => {
  const { ticketId, reason } = req.body || {};
  if (!ticketId) return res.status(400).json({ error: 'ticketId is required' });
  if (!isOptionalNote(reason)) return res.status(400).json({ error: 'reason must be text' });
  const row = getTicket(ticketId);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (rejectTicketTransition('cancel', row, res)) return;
  if (rejectForeignTicket(req.authenticatedAgent, row, res)) return;
  db.prepare('UPDATE tickets SET status=?, finishedAt=?, result=? WHERE id=?')
    .run('canceled', new Date().toISOString(), reason || null, row.id);
  const updated = getTicket(row.id);
  emitQueueUpdate(updated.serviceType);
  res.json({ ticket: updated });
});
app.post('/api/agent/transfer', requireAgentAuth, (req, res) => {
  const { ticketId, toServiceType, toCounter, keepStatus } = req.body || {};
  if (!ticketId) return res.status(400).json({ error: 'ticketId is required' });
  const row = getTicket(ticketId);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (rejectTicketTransition('transfer', row, res)) return;
  if (rejectForeignTicket(req.authenticatedAgent, row, res)) return;
  const targetType = toServiceType ? normalizeServiceType(toServiceType) : row.serviceType;
  if (!targetType) return res.status(400).json({ error: 'invalid serviceType' });
  const keep = keepStatus === true;
  let requestedCounter = null;
  if (toCounter !== undefined) {
    if (typeof toCounter !== 'string' || !toCounter.trim()) return res.status(400).json({ error: 'invalid counter' });
    if (!keep || !['called', 'serving'].includes(row.status)) {
      return res.status(400).json({ error: 'a counter can only be assigned to a called or serving ticket that keeps its status' });
    }
    requestedCounter = toCounter.trim();
    const assigned = db.prepare('SELECT 1 FROM agents WHERE active=1 AND TRIM(counter)=? LIMIT 1').get(requestedCounter);
    if (!assigned) return res.status(400).json({ error: 'unknown counter' });
  }
  const status = keep ? row.status : 'waiting';
  const calledAt = keep ? row.calledAt : null;
  const counter = requestedCounter !== null ? requestedCounter : (keep ? row.counter : null);
  if (keep && counter) {
    const busy = selectBusyCounterStmt.get(String(counter));
    if (busy && busy.id !== row.id) return res.status(409).json({ error: 'counter busy', ticketId: busy.id });
  }
  db.prepare('UPDATE tickets SET serviceType=?, counter=?, status=?, calledAt=? WHERE id=?')
    .run(targetType, counter, status, calledAt, row.id);
  const updated = getTicket(row.id);
  emitQueueUpdate(updated.serviceType);
  res.json({ ticket: updated });
});
app.post('/api/agent/createTicket', requireAgentAuth, (req, res) => {
  const serviceType = normalizeServiceType((req.body || {}).serviceType);
  if (!serviceType) return res.status(400).json({ error: 'invalid serviceType' });
  const ticket = createTicket(serviceType, null);
  emitQueueUpdate(serviceType);
  res.json({ ticket });
});
app.post('/api/agent/callSpecific', requireAgentAuth, (req, res) => {
  const { ticketId, internal } = req.body || {};
  if (!ticketId) return res.status(400).json({ error: 'ticketId is required' });
  const ctr = agentCounter(req.authenticatedAgent);
  if (!ctr) return res.status(400).json({ error: 'counter not assigned' });
  expireStaleTickets();
  const busy = selectBusyCounterStmt.get(ctr);
  if (busy && String(busy.id) !== String(ticketId)) return res.status(409).json({ error: 'counter busy', ticketId: busy.id });
  const row = getTicket(ticketId);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (rejectTicketTransition('callSpecific', row, res)) return;
  if (rejectForeignTicket(req.authenticatedAgent, row, res)) return;
  db.prepare('UPDATE tickets SET status=?, calledAt=?, counter=? WHERE id=?')
    .run('called', new Date().toISOString(), ctr, row.id);
  const updated = getTicket(row.id);
  if (!internal) io.emit('call:made', { ticket: publicTicket(updated) });
  emitQueueUpdate(updated.serviceType);
  res.json({ ticket: updated });
});
app.get('/api/agent/history', requireAgentAuth, (req, res) => {
  const rawLimit = req.query.limit === undefined ? '100' : req.query.limit;
  if (typeof rawLimit !== 'string' || !/^\d+$/.test(rawLimit)) return res.status(400).json({ error: 'invalid limit' });
  const limit = Math.min(Math.max(parseInt(rawLimit, 10), 1), 500);
  let serviceType = null;
  if (req.query.serviceType !== undefined) {
    serviceType = normalizeServiceType(req.query.serviceType);
    if (!serviceType) return res.status(400).json({ error: 'invalid serviceType' });
  }
  const rows = db.prepare(`
    SELECT ${TICKET_COLUMNS} FROM tickets
    WHERE status IN ('finished','canceled')
      ${serviceType ? 'AND serviceType=?' : ''}
    ORDER BY COALESCE(finishedAt, calledAt, createdAt) DESC
    LIMIT ?
  `).all(...(serviceType ? [serviceType, limit] : [limit]));
  res.json({ tickets: rows });
});
app.post('/api/agent/message', requireAgentAuth, async (req, res) => {
  const { text, toCounter, toAgent } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'text is required' });
  const sender = req.authenticatedAgent;
  const payload = { text, from: sender.name || sender.account, toCounter: toCounter || null, toAgent: toAgent || null, time: new Date().toISOString() };
  try {
    if (toCounter) {
      const ctr = String(toCounter).trim();
      await emitToAgents('agent:message', payload, (agent) => agentCounter(agent) === ctr);
      return res.json({ ok: true, targeted: 'counter', toCounter });
    }
    if (toAgent) {
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
app.put('/api/agent/profile', requireAgentAuth, async (req, res) => {
  const agent = req.authenticatedAgent;
  const { name, password, currentPassword } = req.body || {};
  if (name && isDisplayNameTaken(String(name), agent.id)) return res.status(400).json({ error: 'name already in use' });
  let hash = agent.password;
  if (password) {
    if (typeof password !== 'string' || typeof currentPassword !== 'string' ||
      !(await bcrypt.compare(currentPassword, String(agent.password)))) {
      return res.status(403).json({ error: 'current password required' });
    }
    hash = await bcrypt.hash(password, 10);
  }
  const updateName = name || agent.name;
  db.prepare('UPDATE agents SET name=?, password=?, sessionVersion=sessionVersion+?, updatedAt=? WHERE id=?')
    .run(updateName, hash, password ? 1 : 0, new Date().toISOString(), agent.id);
  const updated = db.prepare('SELECT id, account, name, counter, role, active, createdAt, updatedAt, sessionVersion FROM agents WHERE id=?').get(agent.id);
  req.session.agent.sessionVersion = updated.sessionVersion;
  const { sessionVersion, ...safeAgent } = updated;
  res.json({ agent: safeAgent });
});
app.get('/api/qrcode/:ticketId', qrcodeLimiter, async (req, res) => {
  const ticket = getTicket(req.params.ticketId);
  if (!ticket) return res.status(404).send('not found');
  try {
    const buffer = await QRCode.toBuffer(ticketUrlFor(req, ticket.id), { type: 'png', margin: 1, scale: 6 });
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
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON' });
  if (err.expose && err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: err.message });
  console.error('Unhandled error:', isProdEnv ? err.message : err.stack);
  if (isProdEnv) return res.status(500).json({ error: 'internal server error' });
  res.status(500).json({ error: 'internal server error', details: err.message });
});