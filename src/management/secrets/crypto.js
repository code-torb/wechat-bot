import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export function seal({ plaintext, aad, key, keyVersion }) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new TypeError('key must be a 32-byte buffer')
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const cipherText = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    cipher: cipherText.toString('base64'),
    nonce: nonce.toString('base64'),
    tag: tag.toString('base64'),
    keyVersion,
  }
}

export function unseal({ envelope, aad, key }) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new TypeError('key must be a 32-byte buffer')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.nonce, 'base64'))
  decipher.setAAD(Buffer.from(aad, 'utf8'))
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(envelope.cipher, 'base64')), decipher.final()]).toString('utf8')
}

export function credentialAad(record) {
  return `${record.id}:${record.provider_id}:${record.purpose}:${record.key_version}`
}
