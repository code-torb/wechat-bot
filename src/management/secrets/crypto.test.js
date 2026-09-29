import assert from 'node:assert/strict'
import { test } from 'node:test'
import { seal, unseal, credentialAad } from './crypto.js'
import { SecretStore } from './store.js'

const key = Buffer.alloc(32, 7)
const record = { id: 'credential-a', provider_id: 'provider-a', purpose: 'model', key_version: 1 }

test('same plaintext produces different nonces and round trips', () => {
  const first = seal({ plaintext: 'fake-key', aad: credentialAad(record), key, keyVersion: 1 })
  const second = seal({ plaintext: 'fake-key', aad: credentialAad(record), key, keyVersion: 1 })
  assert.notDeepEqual(first.nonce, second.nonce)
  assert.equal(unseal({ envelope: first, aad: credentialAad(record), key }), 'fake-key')
})

test('wrong aad or tampered envelope fails authentication', () => {
  const envelope = seal({ plaintext: 'fake-key', aad: credentialAad(record), key, keyVersion: 1 })
  assert.throws(() => unseal({ envelope, aad: credentialAad({ ...record, id: 'credential-b' }), key }))
  const tampered = { ...envelope, tag: Buffer.alloc(16, 1).toString('base64') }
  assert.throws(() => unseal({ envelope: tampered, aad: credentialAad(record), key }))
})

test('secret store encrypts a database record and only decrypts for the callback', () => {
  const store = new SecretStore({ key })
  const envelope = store.encrypt({ record, plaintext: 's3cret' })
  const sealedRow = { ...record, ...envelope }
  assert.equal(
    store.withSecret(sealedRow, (plaintext) => plaintext),
    's3cret',
  )
  assert.equal(sealedRow.cipher.includes('s3cret'), false)
})
