import { readFileSync } from 'node:fs'
import { seal, unseal, credentialAad } from './crypto.js'

export class SecretStore {
  constructor({ key, keyVersion = 1 }) {
    if (!Buffer.isBuffer(key) || key.length !== 32) throw new TypeError('master key must be a 32-byte buffer')
    this.key = key
    this.keyVersion = keyVersion
  }

  static fromFile({ path, keyVersion = 1 }) {
    const hex = readFileSync(path, 'utf8').trim()
    const key = Buffer.from(hex, 'hex')
    if (key.length !== 32) throw new Error('master key file must contain 32 bytes of hex')
    return new SecretStore({ key, keyVersion })
  }

  encrypt({ record, plaintext }) {
    return seal({ plaintext, aad: credentialAad(record), key: this.key, keyVersion: this.keyVersion })
  }

  decrypt(record) {
    return unseal({ envelope: record, aad: credentialAad(record), key: this.key })
  }

  withSecret(record, callback) {
    const plaintext = this.decrypt(record)
    return callback(plaintext)
  }
}
