import { openDatabase } from '../db/index.js'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function backupDatabase({ source, destination }) {
  const db = openDatabase({ filename: source })
  try {
    return db.backup(destination)
  } finally {
    db.close()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const destination = process.argv[2]
  if (!destination) {
    console.error('usage: node src/management/cli/backup.js <destination.sqlite>')
    process.exit(1)
  }
  backupDatabase({ source: process.env.MANAGEMENT_DB || 'data/management.sqlite', destination })
  console.log(`backup written to ${destination}`)
}
