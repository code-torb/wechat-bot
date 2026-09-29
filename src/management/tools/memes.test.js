import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../db/index.js'
import { createMemeService } from './memes.js'

function pngBuffer(width = 2, height = 2) {
  const buffer = Buffer.alloc(24)
  buffer[0] = 0x89
  buffer[1] = 0x50
  buffer[2] = 0x4e
  buffer[3] = 0x47
  buffer.writeUInt32BE(13, 8)
  buffer.write('IHDR', 12, 'latin1')
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'memes-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const storageDir = join(dir, 'storage')
  const db = openDatabase({ filename: join(dir, 't.sqlite') })
  t.after(() => db.close())
  return { db, memes: createMemeService({ db, storageDir }) }
}

test('upload validates magic bytes, size limit and reads dimensions', (t) => {
  const { memes } = fixture(t)
  const asset = memes.upload({ actor: 'owner-1', dataBase64: pngBuffer().toString('base64'), tags: ['开心'] })
  assert.equal(asset.mime, 'image/png')
  assert.equal(asset.width, 2)
  assert.throws(() => memes.upload({ actor: 'owner-1', dataBase64: Buffer.from('<svg></svg>').toString('base64') }), /disguised/)
  const oversized = Buffer.concat([pngBuffer(), Buffer.alloc(2 * 1024 * 1024)])
  assert.throws(() => memes.upload({ actor: 'owner-1', dataBase64: oversized.toString('base64') }), /2MB/)
})

test('select respects authorization, serious scenes and frequency', (t) => {
  const { memes } = fixture(t)
  const asset = memes.upload({ actor: 'owner-1', dataBase64: pngBuffer().toString('base64'), tags: [] })
  assert.equal(
    memes.select({ context: { turn: 1, authorize: () => true }, assetId: asset.id, lastMemeTurn: null, frequency: 1, scene: 'chat' }).assetId,
    asset.id,
  )
  assert.equal(
    memes.select({ context: { turn: 1, authorize: () => false }, assetId: asset.id, lastMemeTurn: null, frequency: 1, scene: 'chat' }),
    null,
  )
  assert.equal(memes.select({ context: { turn: 1, authorize: () => true }, assetId: asset.id, lastMemeTurn: 0, frequency: 1, scene: 'chat' }), null)
  assert.equal(
    memes.select({ context: { turn: 1, authorize: () => true }, assetId: asset.id, lastMemeTurn: null, frequency: 1, scene: 'file_approval' }),
    null,
  )
  assert.equal(
    memes.select({ context: { turn: 1, authorize: () => true }, assetId: 'missing', lastMemeTurn: null, frequency: 1, scene: 'chat' }),
    null,
  )
  assert.equal(
    memes.select({ context: { turn: 1, authorize: () => true }, assetId: asset.id, lastMemeTurn: null, frequency: 0, scene: 'chat' }),
    null,
  )
})
