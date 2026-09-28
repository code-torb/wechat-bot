import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'

// QQ uses the first 32 bytes of the repeated AppSecret as an Ed25519 seed.
export function createQQSigner(secret) {
  if (typeof secret !== 'string' || !secret.length) throw new Error('QQ AppSecret must not be empty')
  let seed = Buffer.from(secret, 'utf8')
  while (seed.length < 32) seed = Buffer.concat([seed, seed])
  const privateKey = createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed.subarray(0, 32)]),
    format: 'der',
    type: 'pkcs8',
  })
  const publicKey = createPublicKey(privateKey)
  const bytes = (timestamp, body) => Buffer.concat([Buffer.from(timestamp), Buffer.from(body)])
  return {
    sign: (timestamp, body) => sign(null, bytes(timestamp, body), privateKey).toString('hex'),
    verify(timestamp, body, signature) {
      if (typeof timestamp !== 'string' || !/^\d+$/.test(timestamp)) return false
      if (typeof signature !== 'string' || !/^[a-f\d]{128}$/i.test(signature)) return false
      return verify(null, bytes(timestamp, body), publicKey, Buffer.from(signature, 'hex'))
    },
  }
}
