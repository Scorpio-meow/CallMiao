const path = require('path');
const fs = require('fs');
const { openDatabase } = require('./sqlite');
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
module.exports = function createSessionStore(session) {
  class SQLiteSessionStore extends session.Store {
    constructor({ dir, db }) {
      super();
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      this.db = openDatabase(path.join(dir, db));
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('busy_timeout = 5000');
      this.db.exec('CREATE TABLE IF NOT EXISTS sessions (sid PRIMARY KEY, expired, sess)');
      this.getStmt = this.db.prepare('SELECT sess FROM sessions WHERE sid = ? AND ? <= expired');
      this.setStmt = this.db.prepare('INSERT OR REPLACE INTO sessions (sid, expired, sess) VALUES (?, ?, ?)');
      this.touchStmt = this.db.prepare('UPDATE sessions SET expired = ? WHERE sid = ?');
      this.destroyStmt = this.db.prepare('DELETE FROM sessions WHERE sid = ?');
      this.cleanupStmt = this.db.prepare('DELETE FROM sessions WHERE ? > expired');
      this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
      this.cleanupTimer.unref();
      this.cleanup();
    }
    cleanup() {
      try {
        this.cleanupStmt.run(Date.now());
      } catch (err) {
        console.warn('Session cleanup failed:', err && err.message);
      }
    }
    static expiryOf(sess) {
      return new Date(sess.cookie.expires).getTime();
    }
    get(sid, cb) {
      try {
        const row = this.getStmt.get(sid, Date.now());
        cb(null, row ? JSON.parse(row.sess) : null);
      } catch (err) {
        cb(err);
      }
    }
    set(sid, sess, cb) {
      try {
        this.setStmt.run(sid, SQLiteSessionStore.expiryOf(sess), JSON.stringify(sess));
        if (cb) cb(null);
      } catch (err) {
        if (cb) cb(err);
      }
    }
    touch(sid, sess, cb) {
      try {
        this.touchStmt.run(SQLiteSessionStore.expiryOf(sess), sid);
        if (cb) cb(null);
      } catch (err) {
        if (cb) cb(err);
      }
    }
    destroy(sid, cb) {
      try {
        this.destroyStmt.run(sid);
        if (cb) cb(null);
      } catch (err) {
        if (cb) cb(err);
      }
    }
  }
  return SQLiteSessionStore;
};