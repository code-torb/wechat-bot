export function createSearchTool({ db, secretStore, fetchFn = fetch, timeoutMs = 8000 }) {
  return async function searchWeb({ query, limit = 5, signal }) {
    const model = db.prepare('SELECT * FROM models WHERE search_key_cipher IS NOT NULL AND enabled = 1 ORDER BY updated_at DESC LIMIT 1').get()
    if (!model) throw new Error('search model is not configured')
    const record = {
      ...model,
      cipher: model.search_key_cipher,
      nonce: model.search_key_nonce,
      tag: model.search_key_tag,
      key_version: model.search_key_version,
    }
    const apiKey = secretStore.withSecret(record, (value) => value)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const onSignal = () => controller.abort()
    signal?.addEventListener('abort', onSignal, { once: true })
    try {
      const response = await fetchFn(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(Math.max(limit, 1), 5)}`,
        { headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey }, signal: controller.signal },
      )
      if (!response.ok) throw new Error(`search provider returned ${response.status}`)
      const payload = await response.json()
      const results = (payload.web?.results || []).slice(0, limit).map((item) => ({
        title: item.title || '',
        url: item.url || '',
        snippet: item.description || '',
      }))
      return { results, fetchedAt: Date.now() }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onSignal)
    }
  }
}
