const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// Config
const DB_PATH = path.join(__dirname, '..', 'db', 'queue.db');
const DEFAULT_ACCOUNT = 'admin';
const DEFAULT_NAME = 'Administrator';

function genPassword() {
  // 12-char hex (lowercase) -> 12 chars
  return crypto.randomBytes(8).toString('hex').slice(0, 12);
}

function main() {
  console.log('Using DB:', DB_PATH);
  const db = new Database(DB_PATH);

  // ensure agents table exists (server.js creates it on start, but double-check)
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

  const password = genPassword();
  const hash = bcrypt.hashSync(String(password), 10);
  const now = new Date().toISOString();

  try {
    const info = db.prepare('INSERT INTO agents(account,name,password,counter,role,createdAt) VALUES (?,?,?,?,?,?)')
      .run(account, DEFAULT_NAME, hash, null, 'admin', now);
    console.log('Created admin account:');
    console.log(`  account: ${account}`);
    console.log(`  name: ${DEFAULT_NAME}`);
    console.log(`  id: ${info.lastInsertRowid}`);
    console.log(`  password (temporary, please change ASAP): ${password}`);
    console.log('\nSuggestion: login via /login and change the password, or use the management API to update the password.');
    process.exit(0);
  } catch (err) {
    console.error('Failed to create admin account:', err && err.message);
    process.exit(1);
  }
}

main();
