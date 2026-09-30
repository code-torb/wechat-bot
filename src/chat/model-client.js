import OpenAI from 'openai'

export function createModelClient({ secretStore }) {
  return async function complete({ provider, credentialRow, messages, tools, signal, transport }) {
    if (!credentialRow) throw new Error('model credential is required')
    const apiKey = secretStore.withSecret(credentialRow, (value) => value)
    const client = new OpenAI({
      apiKey: apiKey || 'unset',
      baseURL: provider.base_url,
      maxRetries: 0,
      timeout: provider.timeoutMs || 45000,
      fetch: transport,
    })
    const response = await client.chat.completions.create(
      {
        model: provider.modelName,
        messages,
        ...(tools && tools.length ? { tools, tool_choice: 'auto' } : {}),
        max_tokens: provider.maxTokens || 1000,
      },
      { signal },
    )
    const message = response?.choices?.[0]?.message
    const text = typeof message?.content === 'string' ? message.content.trim() : ''
    const toolCalls = Array.isArray(message?.tool_calls)
      ? message.tool_calls.map((call) => ({
          id: call.id,
          name: call.function?.name || '',
          arguments: JSON.parse(call.function?.arguments || '{}'),
        }))
      : []
    const usage = response?.usage
      ? { inputTokens: response.usage.prompt_tokens ?? null, outputTokens: response.usage.completion_tokens ?? null }
      : null
    return { text, toolCalls, usage }
  }
}
