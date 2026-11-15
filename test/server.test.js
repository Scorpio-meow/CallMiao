const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { openDatabase } = require('../lib/sqlite');
setDefaultTimeout(30000);
const SESSION_SECRET = crypto.randomBytes(32).toString('hex');
const EMBED_ORIGIN = 'https://embed.example';
const BUSINESS_TZ = 'Asia/Kolkata';
const BUSINESS_TZ_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function startOfBusinessDay() {
  const local = new Date(Date.now() + BUSINESS_TZ_OFFSET_MS);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - BUSINESS_TZ_OFFSET_MS;
}
let tempDir;
let serverProcess;
let baseUrl;
let queueDb;
let sessionDb;
function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, 'localhost', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}
async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch (err) {
      await Bun.sleep(100);
    }
  }
  throw new Error('server did not start');
}
function createAgent(account, counter, role) {
  const info = queueDb.query('INSERT INTO agents(account, name, password, counter, role, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
    .run(account, account, bcrypt.hashSync('secret-pass', 4), counter, role, new Date().toISOString());
  return queueDb.query('SELECT * FROM agents WHERE id=?').get(info.lastInsertRowid);
}
function loginAs(agent) {
  const sid = crypto.randomBytes(16).toString('hex');
  const csrfToken = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 60 * 60 * 1000);
  const sess = {
    cookie: { originalMaxAge: 60 * 60 * 1000, expires: expires.toISOString(), secure: false, httpOnly: true, path: '/', sameSite: 'lax' },
    agent: { id: agent.id, account: agent.account, name: agent.name, counter: agent.counter, role: agent.role, sessionVersion: agent.sessionVersion },
    csrfToken
  };
  sessionDb.query('INSERT INTO sessions (sid, expired, sess) VALUES (?, ?, ?)').run(sid, expires.getTime(), JSON.stringify(sess));
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(sid).digest('base64').replace(/=+$/, '');
  const cookie = `queueSessionId=${encodeURIComponent(`s:${sid}.${signature}`)}`;
  return (method, urlPath, body) => fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: { cookie, 'x-csrf-token': csrfToken, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}
function postAnonymous(urlPath, body, headers) {
  return fetch(`${baseUrl}${urlPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}
beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'callmiao-test-'));
  const port = await freePort();
  baseUrl = `http://localhost:${port}`;
  const env = { ...process.env };
  delete env.PUBLIC_ORIGIN;
  Object.assign(env, {
    TZ: BUSINESS_TZ,
    TRUST_PROXY: 'loopback',
    PORT: String(port),
    NODE_ENV: 'development',
    SESSION_SECRET,
    SERVICE_TYPES: 'A,B',
    SERVICE_NAME_A: '一般服務',
    SERVICE_DESC_A: '一般業務',
    SERVICE_NAME_B: '理賠服務',
    SERVICE_DESC_B: '理賠送件',
    MAX_WAITING_PER_SERVICE: '10',
    MAX_WAITING_PER_CLIENT: '2',
    KIOSK_IPS: '',
    DB_DIR: tempDir,
    ALLOWED_ORIGINS: EMBED_ORIGIN
  });
  serverProcess = Bun.spawn([process.execPath, path.join(__dirname, '..', 'server.js')], {
    cwd: tempDir,
    env,
    stdout: 'ignore',
    stderr: 'ignore'
  });
  await waitForServer();
  queueDb = openDatabase(path.join(tempDir, 'queue.db'));
  sessionDb = openDatabase(path.join(tempDir, 'sessions.db'));
});
afterAll(async () => {
  queueDb.close();
  sessionDb.close();
  serverProcess.kill();
  await serverProcess.exited;
  fs.rmSync(tempDir, { recursive: true, force: true });
});
test('only tickets from before the business day in TZ are expired on the first queue read', async () => {
  const insert = queueDb.query("INSERT INTO tickets(serviceType, number, status, counter, createdAt, calledAt) VALUES ('A', ?, ?, '9', ?, ?)");
  const before = new Date(startOfBusinessDay() - 60 * 1000).toISOString();
  const after = new Date(startOfBusinessDay() + 60 * 1000).toISOString();
  const stale = insert.run('A001', 'called', before, before).lastInsertRowid;
  const current = insert.run('A002', 'serving', after, after).lastInsertRowid;
  const overview = await (await fetch(`${baseUrl}/api/overview`)).json();
  expect(overview.currentCalls.map(c => c.id)).toEqual([Number(current)]);
  const status = queueDb.query('SELECT status, result FROM tickets WHERE id=?');
  expect(status.get(stale)).toEqual({ status: 'canceled', result: 'expired' });
  expect(status.get(current)).toEqual({ status: 'serving', result: null });
});
test('anonymous ticket creation is capped per client and hides internal fields', async () => {
  const first = await postAnonymous('/api/tickets', { serviceType: 'B' });
  expect(first.status).toBe(200);
  const body = await first.json();
  expect(body.ticket.clientKey).toBeUndefined();
  expect(body.ticketUrl).toBe(`${baseUrl}/ticket/index.html?id=${body.ticket.id}`);
  expect((await postAnonymous('/api/tickets', { serviceType: 'B' })).status).toBe(200);
  expect((await postAnonymous('/api/tickets', { serviceType: 'A' })).status).toBe(429);
});
test('the overview pushes the waiting order of every service', async () => {
  const overview = await (await fetch(`${baseUrl}/api/overview`)).json();
  expect(Object.keys(overview.waiting)).toEqual(['A', 'B']);
  expect(overview.waiting.B.map(t => t.number)).toEqual(['B001', 'B002']);
  expect(overview.summary).toEqual([{ serviceType: 'A', waiting: 0 }, { serviceType: 'B', waiting: 2 }]);
});
test('clients in the same IPv6 /56 share one waiting-ticket cap', async () => {
  const from = (ip) => postAnonymous('/api/tickets', { serviceType: 'B' }, { 'x-forwarded-for': ip });
  expect((await from('2001:db8:0:1::1')).status).toBe(200);
  expect((await from('2001:db8:0:2::1')).status).toBe(200);
  const blocked = await from('2001:db8:0:3::1');
  expect(blocked.status).toBe(429);
  expect((await blocked.json()).error).toBe('too many waiting tickets from this network');
  expect((await from('2001:db8:1::1')).status).toBe(200);
});
test('agents can only act on called tickets of their own counter', async () => {
  const alice = loginAs(createAgent('alice', '1', null));
  const bob = loginAs(createAgent('bob', '2', null));
  const created = (await (await alice('POST', '/api/agent/createTicket', { serviceType: 'A' })).json()).ticket;
  const called = await alice('POST', '/api/agent/callNext', { serviceType: 'A' });
  expect(called.status).toBe(200);
  expect((await called.json()).ticket.id).toBe(created.id);
  expect((await bob('POST', '/api/agent/finish', { ticketId: created.id })).status).toBe(403);
  expect((await bob('POST', '/api/agent/cancel', { ticketId: created.id })).status).toBe(403);
  expect((await bob('POST', '/api/agent/callSpecific', { ticketId: created.id })).status).toBe(403);
  expect((await alice('POST', '/api/agent/callNext', { serviceType: 'A' })).status).toBe(409);
  expect((await alice('POST', '/api/agent/finish', { ticketId: created.id })).status).toBe(200);
  expect((await alice('POST', '/api/agent/finish', { ticketId: created.id })).status).toBe(409);
});
test('a transfer may assign a counter only while the ticket keeps its called status', async () => {
  const carol = loginAs(createAgent('carol', '3', null));
  createAgent('dave', '4', null);
  const ticket = (await (await carol('POST', '/api/agent/createTicket', { serviceType: 'A' })).json()).ticket;
  expect((await carol('POST', '/api/agent/transfer', { ticketId: ticket.id, toCounter: '4', keepStatus: false })).status).toBe(400);
  expect((await carol('POST', '/api/agent/callSpecific', { ticketId: ticket.id })).status).toBe(200);
  const moved = await carol('POST', '/api/agent/transfer', { ticketId: ticket.id, toCounter: '4', keepStatus: true });
  expect(moved.status).toBe(200);
  expect((await moved.json()).ticket.counter).toBe('4');
});
test('resetting a password revokes the account sessions', async () => {
  const erinRow = createAgent('erin', '5', null);
  const erin = loginAs(erinRow);
  const root = loginAs(createAgent('root', null, 'admin'));
  expect((await erin('GET', '/api/agent/profile')).status).toBe(200);
  expect((await root('PUT', `/api/agents/${erinRow.id}`, { password: 'new-pass' })).status).toBe(200);
  expect((await erin('GET', '/api/agent/profile')).status).toBe(401);
});
test('captcha tokens are single use', async () => {
  const { token } = await (await fetch(`${baseUrl}/api/captcha/new`)).json();
  const attempt = async () => (await postAnonymous('/api/login', { account: 'nobody', password: 'x', captchaToken: token, captcha: 'wrong!' })).json();
  expect((await attempt()).error).toBe('captcha mismatch');
  expect((await attempt()).error).toBe('invalid or expired captcha token');
});
test('foreign origins get 403 while the server accepts its own host', async () => {
  const foreign = await postAnonymous('/api/tickets', { serviceType: 'A' }, { origin: 'https://evil.example' });
  expect(foreign.status).toBe(403);
  expect((await fetch(`${baseUrl}/api/overview`, { headers: { host: 'kiosk.lan:8080', origin: 'http://kiosk.lan:8080' } })).status).toBe(200);
  expect((await fetch(`${baseUrl}/api/overview`, { headers: { origin: EMBED_ORIGIN } })).status).toBe(200);
});
test('only kiosk pages can be framed by allowed origins', async () => {
  const kiosk = await fetch(`${baseUrl}/kiosk/index.html`);
  expect(kiosk.headers.get('content-security-policy')).toContain(`frame-ancestors 'self' ${EMBED_ORIGIN}`);
  expect(kiosk.headers.get('x-frame-options')).toBeNull();
  const agent = await fetch(`${baseUrl}/agent/index.html`);
  expect(agent.headers.get('content-security-policy')).toContain("frame-ancestors 'self';");
  expect(agent.headers.get('x-frame-options')).toBe('SAMEORIGIN');
});