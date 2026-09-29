export function createSearchTool({ secretStore, fetchFn = fetch, timeoutMs = 8000 }) {
  return async function searchWeb({ query, limit = 5, credentialRef, providerId, signal }) {
    const apiKey = secretStore.withSecret({ id: credentialRef, provider_id: providerId, purpose: 'search', key_version: 1 }, (value) => value)
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
