import { createHash, randomBytes } from 'node:crypto'

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

export class SessionStore {
  constructor({ db, ttlMs = 12 * 60 * 60 * 1000, now = Date.now }) {
    this.db = db
    this.ttlMs = ttlMs
    this.now = now
  }

  create(userId) {
    const token = randomBytes(32).toString('base64url')
    const csrf = randomBytes(24).toString('base64url')
    const id = randomBytes(16).toString('hex')
    const now = this.now()
    this.db
      .prepare('INSERT INTO admin_sessions (id, token_hash, user_id, csrf_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, hashToken(token), userId, createHash('sha256').update(csrf).digest('hex'), now + this.ttlMs, now)
    return { token, csrf, expiresAt: now + this.ttlMs }
  }

  validate(token) {
    if (!token) return null
    const row = this.db.prepare('SELECT * FROM admin_sessions WHERE token_hash = ?').get(hashToken(token))
    if (!row || row.revoked_at || row.expires_at <= this.now()) return null
    return row
  }

  checkCsrf(session, csrfToken) {
    if (!csrfToken) return false
    const expected = createHash('sha256').update(csrfToken).digest('hex')
    return expected === session.csrf_hash
  }

  revoke(token) {
    this.db.prepare('UPDATE admin_sessions SET revoked_at = ? WHERE token_hash = ?').run(this.now(), hashToken(token))
  }
}
