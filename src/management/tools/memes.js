import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const MAX_BYTES = 2 * 1024 * 1024
const SERIOUS_SCENES = ['serious_help', 'error_alert', 'file_approval']

function magicOf(buffer) {
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png'
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return 'image/gif'
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  )
    return 'image/webp'
  return null
}

function dimensionsOf(mime, buffer) {
  if (mime === 'image/png') return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  if (mime === 'image/gif') return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
  if (mime === 'image/jpeg') {
    let offset = 2
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1
        continue
      }
      const marker = buffer[offset + 1]
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) }
      }
      offset += 2 + buffer.readUInt16BE(offset + 2)
    }
    return null
  }
  if (mime === 'image/webp') {
    if (buffer.subarray(12, 16).toString('latin1') === 'VP8X') {
      return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) }
    }
    if (buffer.subarray(12, 16).toString('latin1') === 'VP8 ') {
      return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff }
    }
    return null
  }
  return null
}

export function createMemeService({ db, storageDir }) {
  if (!existsSync(storageDir)) mkdirSync(storageDir, { recursive: true })

  function readAsset(assetId) {
    const row = db.prepare('SELECT * FROM meme_assets WHERE id = ?').get(assetId)
    if (!row || !row.enabled) return null
    const path = join(storageDir, row.storage_key)
    if (!existsSync(path)) return null
    return { row, buffer: readFileSync(path) }
  }

  return {
    upload({ actor, dataBase64, tags = [] }) {
      const buffer = Buffer.from(dataBase64, 'base64')
      if (buffer.length === 0) throw new Error('empty file')
      if (buffer.length > MAX_BYTES) throw new Error('file exceeds 2MB limit')
      const mime = magicOf(buffer)
      if (!mime) throw new Error('unsupported or disguised file type')
      const dimensions = dimensionsOf(mime, buffer)
      if (!dimensions) throw new Error('cannot read image dimensions')
      const ext = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1]
      const storageKey = `${randomUUID()}.${ext}`
      writeFileSync(join(storageDir, storageKey), buffer)
      const id = randomUUID()
      db.prepare(
        'INSERT INTO meme_assets (id, storage_key, mime, bytes, sha256, tags_json, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
      ).run(id, storageKey, mime, buffer.length, createHash('sha256').update(buffer).digest('hex'), JSON.stringify(tags), Date.now(), Date.now())
      return { id, mime, bytes: buffer.length, width: dimensions.width, height: dimensions.height }
    },
    list() {
      return db
        .prepare('SELECT id, mime, bytes, sha256, tags_json, enabled, created_at FROM meme_assets ORDER BY created_at DESC')
        .all()
        .map((row) => ({
          id: row.id,
          mime: row.mime,
          bytes: row.bytes,
          sha256: row.sha256,
          tags: JSON.parse(row.tags_json),
          enabled: Boolean(row.enabled),
          createdAt: row.created_at,
        }))
    },
    setEnabled({ assetId, enabled }) {
      db.prepare('UPDATE meme_assets SET enabled = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, Date.now(), assetId)
    },
    select({ context, assetId, lastMemeTurn, frequency = 0.2, scene }) {
      if (SERIOUS_SCENES.includes(scene)) return null
      if (lastMemeTurn !== null && lastMemeTurn >= context.turn - 3) return null
      if (frequency <= 0 || Math.random() > Math.min(Math.max(frequency, 0), 1)) return null
      const asset = readAsset(assetId)
      if (!asset) return null
      if (context.authorize?.(assetId) === false) return null
      return { assetId, mime: asset.row.mime, buffer: asset.buffer }
    },
    readAuthorizedAsset({ assetId, allowed = true }) {
      if (!allowed) return null
      const asset = readAsset(assetId)
      return asset ? { mime: asset.row.mime, buffer: asset.buffer } : null
    },
  }
}
