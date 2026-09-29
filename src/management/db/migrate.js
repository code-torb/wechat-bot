import { readdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const migrationsDir = dirname(fileURLToPath(import.meta.url)) + '/migrations'

function checksum(sql) {
  return createHash('sha256').update(sql).digest('hex')
}

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `)
  const applied = new Map(
    db
      .prepare('SELECT version, checksum FROM migrations')
      .all()
      .map((row) => [row.version, row.checksum]),
  )
  const files = readdirSync(migrationsDir)
    .filter((name) => /^\d+-.*\.sql$/.test(name))
    .sort()
  let lastVersion = 0
  for (const file of files) {
    const version = Number.parseInt(file, 10)
    const sql = readFileSync(join(migrationsDir, file), 'utf8')
    const sum = checksum(sql)
    if (applied.has(version)) {
      if (applied.get(version) !== sum) {
        throw new Error(`migration ${file} checksum mismatch`)
      }
      lastVersion = version
      continue
    }
    db.transaction(() => {
      db.exec(sql)
      db.prepare('INSERT INTO migrations (version, checksum, applied_at) VALUES (?, ?, ?)').run(version, sum, Date.now())
    })()
    lastVersion = version
  }
  return lastVersion
}
