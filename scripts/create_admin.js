const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const DB_PATH = path.join(__dirname, '..', 'db', 'queue.db');
const DEFAULT_ACCOUNT = 'admin';
const DEFAULT_NAME = 'Administrator';
function genPassword() {
  return crypto.randomBytes(8).toString('hex').slice(0, 12);
}
function maskSecret(secret, left = 2, right = 2) {
  if (!secret) return '***';
  const s = String(secret);
  if (s.length <= left + right + 2) return '***';
  const leftPart = s.slice(0, left);
  const rightPart = s.slice(-right);
  const masked = '*'.repeat(Math.max(3, s.length - left - right));
  return `${leftPart}${masked}${rightPart}`;
}
function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach(a => {
    if (!a.startsWith('--')) return;
    const eq = a.indexOf('=');
    if (eq > 0) {
      args[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      args[a.slice(2)] = true;
    }
  });
  return args;
}
function main() {
  const args = parseArgs();
  console.log('Using DB:', DB_PATH);
  const db = new Database(DB_PATH);
  const tbl = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agents'").get();
  if (!tbl) {
    console.error('agents table not found in DB. Start the server once to initialize DB or create the table manually.');
    process.exit(2);
  }
  const account = DEFAULT_ACCOUNT;
  const existing = db.prepare('SELECT id, account, name, role, active, createdAt FROM agents WHERE account=?').get(account);
  if (existing) {
    console.log(`Account already exists: ${existing.account} (id=${existing.id}, role=${existing.role}, active=${existing.active})`);
    console.log('If you want to reset the password, run the script with a different account or update the password via the management UI/API.');
    process.exit(0);
  }
  const password = args.password || genPassword();
  const hash = bcrypt.hashSync(String(password), 10);
  const now = new Date().toISOString();
  try {
    const info = db.prepare('INSERT INTO agents(account,name,password,counter,role,createdAt) VALUES (?,?,?,?,?,?)')
      .run(account, DEFAULT_NAME, hash, null, 'admin', now);
    console.log('Created admin account:');
    console.log(`  account: ${account}`);
    console.log(`  name: ${DEFAULT_NAME}`);
    console.log(`  id: ${info.lastInsertRowid}`);
    const printPassword = !!args['print-password'] || !!args['print_password'];
    if (printPassword) {
      // Print a masked version instead of the cleartext password to avoid leaking secrets in logs
      console.log(`  password (temporary, masked, please change ASAP): ${maskSecret(password)}`);
    } else {
      console.log('  Temporary password has been generated but NOT displayed for security reasons.');
      console.log('  To show it once on the console, re-run this command with --print-password (use with caution).');
    }
    console.log('\nSuggestion: login via /login and change the password, or use the management API to update the password.');
    process.exit(0);
  } catch (err) {
    console.error('Failed to create admin account:', err && err.message);
    process.exit(1);
  }
}
main();