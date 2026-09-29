import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFileClient } from './file-client.js'

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.keys(value)
    .filter((key) => key !== 'signature')
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(',')}}`
}

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'file-client-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const socketPath = join(dir, 'executor.sock')
  const secret = 'fixture-secret'
  const received = []
  const server = createServer((socket) => {
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      if (!buffer.includes('\n')) return
      const [line] = buffer.split('\n')
      const payload = JSON.parse(line)
      received.push(payload)
      const expected = createHmac('sha256', secret).update(canonical(payload)).digest('hex')
      if (payload.signature !== expected) {
        socket.end(JSON.stringify({ id: payload.id, status: 'failed', errorCode: 'BAD_SIGNATURE' }) + '\n')
        return
      }
      socket.end(JSON.stringify({ id: payload.id, status: 'ok', data: { committed: true } }) + '\n')
    })
  })
  return new Promise((resolve) => {
    server.listen(socketPath, () => {
      t.after(() => server.close())
      resolve({ socketPath, secret, received, client: createFileClient({ socketPath, secret }) })
    })
  })
}

test('file client signs requests and parses responses', async (t) => {
  const { client, received } = await fixture(t)
  const response = await client.call({
    resourceId: 'notes',
    action: 'commit_write',
    relativePath: 'a.txt',
    content: 'v2',
    expectedHash: createHash('sha256').update('v1').digest('hex'),
  })
  assert.equal(response.status, 'ok')
  assert.equal(received[0].action, 'commit_write')
  assert.equal(received[0].resourceId, 'notes')
  assert.ok(received[0].nonce)
  assert.ok(received[0].expiresAt > Date.now())
})
