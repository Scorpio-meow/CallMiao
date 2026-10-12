// SQLite driver selection: Bun cannot load the better-sqlite3 native addon, so under Bun use the built-in
// bun:sqlite and expose the better-sqlite3 surface that server.js relies on (pragma()).
const isBun = Boolean(process.versions && process.versions.bun);

function openDatabase(dbPath) {
  if (!isBun) {
    const BetterSqlite3 = require('better-sqlite3');
    return new BetterSqlite3(dbPath);
  }
  const { Database } = require('bun:sqlite');
  const db = new Database(dbPath);
  db.pragma = (statement) => db.prepare(`PRAGMA ${statement}`).all();
  return db;
}

module.exports = { isBun, openDatabase };
