const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const readline = require('readline');
const DB_PATH = path.join(__dirname, '..', 'db', 'queue.db');
const DEFAULT_ACCOUNT = 'admin';
function genPassword() {
  return crypto.randomBytes(16).toString('base64').replace(/[+/=]/g, '').slice(0, 12);
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
function askPassword(promptText) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.stdoutMuted = true;
    rl._writeToOutput = function _writeToOutput(stringToWrite) {
      if (rl.stdoutMuted) rl.output.write('*');
      else rl.output.write(stringToWrite);
    };
    rl.question(promptText, (pw) => {
      rl.history = rl.history || [];
      rl.close();
      process.stdout.write('\n');
      resolve(pw);
    });
    rl.stdoutMuted = true;
  });
}
function main() {
  const args = parseArgs();
  const account = args.account || DEFAULT_ACCOUNT;
  const generate = args.generate || args.g;
  const createIfMissing = args.create || args.c;
  (async () => {
    let password = args.password;
    if (!password && !generate) {
      console.log('No --password provided. You can provide --password=NEW or use --generate to auto-generate.');
      try {
        password = await askPassword('Enter new password (input hidden): ');
      } catch (e) {
        password = null;
      }
    }
    if (!password) {
      if (generate) password = genPassword();
      else if (!password) {
        console.error('No password provided. Use --password=... or --generate.');
        process.exit(2);
      }
    }
    const db = new Database(DB_PATH);
    const tbl = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agents'").get();
    if (!tbl) {
      console.error('agents table not found in DB. Start the server once to initialize DB or create the table manually.');
      process.exit(2);
    }
    const existing = db.prepare('SELECT id, account, role, active FROM agents WHERE account=?').get(account);
    const hash = bcrypt.hashSync(String(password), 10);
    const now = new Date().toISOString();
    try {
      if (existing) {
        const info = db.prepare('UPDATE agents SET password=?, updatedAt=? WHERE account=?').run(hash, now, account);
        if (info.changes > 0) {
          console.log(`Password updated for account: ${account} (id=${existing.id})`);
          const printPassword = !!args['print-password'] || !!args['print_password'];
          if (printPassword) {
            console.log('Temporary password (masked, copy now and change after login):', maskSecret(password));
          } else {
            console.log('Temporary password has been generated but NOT shown here for security reasons.');
            console.log('To show it once on the console, re-run this command with --print-password (use with caution).');
          }
          process.exit(0);
        } else {
          console.error('Failed to update password (no rows changed).');
          process.exit(1);
        }
      } else if (createIfMissing) {
        const NAME = args.name || 'Administrator';
        const info = db.prepare('INSERT INTO agents(account,name,password,counter,role,createdAt,active) VALUES (?,?,?,?,?,?,?)')
          .run(account, NAME, hash, null, 'admin', now, 1);
        console.log('Created admin account:');
        console.log(`  account: ${account}`);
        console.log(`  name: ${NAME}`);
        console.log(`  id: ${info.lastInsertRowid}`);
        const printPassword = !!args['print-password'] || !!args['print_password'];
        if (printPassword) {
          console.log('Temporary password (masked, copy now and change after login):', maskSecret(password));
        } else {
          console.log('Temporary password has been generated but NOT shown here for security reasons.');
          console.log('To show it once on the console, re-run this command with --print-password (use with caution).');
        }
        process.exit(0);
      } else {
        console.error(`Account not found: ${account}. Use --create to create the account.`);
        process.exit(2);
      }
    } catch (err) {
      console.error('DB error:', err && err.message);
      process.exit(1);
    }
  })();
}
main();