import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createQQSigner } from './signature.js'

test('callback challenge matches the published QQ signature vector', () => {
  const signer = createQQSigner('DG5g3B4j9X2KOErG')
  assert.equal(
    signer.sign('1725442341', 'Arq0D5A61EgUu4OxUvOp'),
    '87befc99c42c651b3aac0278e71ada338433ae26fcb24307bdc5ad38c1adc2d01bcfcadc0842edac85e85205028a1132afe09280305f13aa6909ffc2d652c706',
  )
})

test('verifies exact raw request bytes, rejecting whitespace and timestamp changes', () => {
  const signer = createQQSigner('naOC0ocQE3shWLAfffVLB1rhYPG7')
  const body = '{ "op": 0,"d": {}, "t": "GATEWAY_EVENT_NAME"}'
  const signature = signer.sign('1725442341', body)
  assert.equal(signer.verify('1725442341', Buffer.from(body), signature), true)
  assert.equal(signer.verify('1725442341', Buffer.from(body + ' '), signature), false)
  assert.equal(signer.verify('1725442342', body, signature), false)
  for (const bad of ['', 'zz'.repeat(64), '00'.repeat(63), signature + '00']) {
    assert.equal(signer.verify('1725442341', body, bad), false)
  }
  assert.equal(signer.verify('', body, signature), false)
})

test('empty secret is rejected rather than looping during seed expansion', () => {
  assert.throws(() => createQQSigner(''), /secret/i)
})
