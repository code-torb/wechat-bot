import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { randomUUID } from 'node:crypto'
import { openDatabase } from '../db/index.js'
import { hashPassword } from '../auth/passwords.js'

export async function bootstrapOwner({ databaseFile }) {
  const db = openDatabase({ filename: databaseFile })
  const existing = db.prepare('SELECT COUNT(*) AS count FROM admin_users WHERE role = ?').get('owner').count
  if (existing > 0) {
    db.close()
    throw new Error('an owner account already exists')
  }
  const rl = createInterface({ input: stdin, output: stdout })
  try {
    const username = (await rl.question('owner username: ')).trim()
    const password = await rl.question('owner password: ')
    const confirm = await rl.question('confirm password: ')
    if (!username || !password) throw new Error('username and password are required')
    if (password !== confirm) throw new Error('passwords do not match')
    const now = Date.now()
    db.prepare('INSERT INTO admin_users (id, username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      randomUUID(),
      username,
      await hashPassword(password),
      'owner',
      now,
      now,
    )
    console.log(`owner account "${username}" created`)
  } finally {
    rl.close()
    db.close()
  }
}
