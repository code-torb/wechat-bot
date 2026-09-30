import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSearchTool } from './search.js'

test('search returns up to five results and preserves the query', async () => {
  const seen = []
  const search = createSearchTool({
    db: {
      prepare: () => ({
        get: () => ({
          id: 'model-s',
          base_url: 'https://example.test/v1',
          search_key_cipher: 'cipher',
          search_key_nonce: 'nonce',
          search_key_tag: 'tag',
          search_key_version: 1,
          aad_kind: 'model',
          enabled: 1,
        }),
      }),
    },
    secretStore: { withSecret: (_record, callback) => callback('fixture-key') },
    fetchFn: async (url, options) => {
      seen.push({ url, auth: options.headers['X-Subscription-Token'] })
      return {
        ok: true,
        json: async () => ({
          web: { results: Array.from({ length: 8 }, (_, i) => ({ title: `t${i}`, url: `https://example.com/${i}`, description: `d${i}` })) },
        }),
      }
    },
  })
  const result = await search({ query: '天气', limit: 5 })
  assert.equal(result.results.length, 5)
  assert.equal(seen[0].auth, 'fixture-key')
  assert.match(seen[0].url, /q=%E5%A4%A9%E6%B0%94/)
  assert.equal(result.results[0].url, 'https://example.com/0')
})

test('search failure is surfaced without leaking the credential', async () => {
  const search = createSearchTool({
    db: {
      prepare: () => ({
        get: () => ({
          id: 'model-s',
          base_url: 'https://example.test/v1',
          search_key_cipher: 'cipher',
          search_key_nonce: 'nonce',
          search_key_tag: 'tag',
          search_key_version: 1,
          aad_kind: 'model',
          enabled: 1,
        }),
      }),
    },
    secretStore: { withSecret: (_record, callback) => callback('fixture-secret-value') },
    fetchFn: async () => ({ ok: false, status: 401 }),
  })
  await assert.rejects(() => search({ query: 'x' }), /401/)
})

test('network policy blocks metadata, loopback and private hosts', async () => {
  const { hostPolicy, validateProviderBaseUrl } = await import('../secrets/provider-network.js')
  assert.equal(hostPolicy('169.254.169.254').reason, 'metadata')
  assert.equal(hostPolicy('localhost').reason, 'loopback')
  assert.equal(hostPolicy('10.0.0.1').reason, 'private')
  assert.equal(hostPolicy('api.openai.com').blocked, false)
  assert.throws(() => validateProviderBaseUrl('http://api.example.com/v1'), /https/)
  assert.throws(() => validateProviderBaseUrl('https://169.254.169.254/v1'), /metadata/)
})
