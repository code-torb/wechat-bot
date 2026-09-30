import OpenAI from 'openai'

export function createEmbeddingClient({ db, secretStore, transport }) {
  if (!secretStore) return null
  const row = db.prepare("SELECT * FROM models WHERE embedding_model != '' AND enabled = 1 ORDER BY updated_at DESC LIMIT 1").get()
  if (!row) return null
  const apiKey = secretStore.withSecret(row, (value) => value)
  const model = row.embedding_model
  const client = new OpenAI({
    apiKey: apiKey || 'unset',
    baseURL: row.base_url,
    maxRetries: 0,
    timeout: 45000,
    fetch: transport,
  })
  return {
    model,
    async embed(texts) {
      const response = await client.embeddings.create({ model, input: texts, encoding_format: 'float' })
      return response.data.map((item) => Float32Array.from(item.embedding))
    },
  }
}
