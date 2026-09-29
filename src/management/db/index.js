import Database from 'better-sqlite3'
import { migrate } from './migrate.js'

export function openDatabase({ filename }) {
  const db = new Database(filename)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  migrate(db)
  return db
}
